#!/usr/bin/env python3
"""Email a calendar invite to every member of a channel meeting."""

import calendar
import json
import os
import re
import secrets
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

CONFIG_PATH = "/opt/mattermost/volumes/app/mattermost/config/config.json"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOMS_PATH = os.path.join(BASE_DIR, "rooms.json")
TEMPLATE_PATH = os.path.join(BASE_DIR, "meet.html")
MATTERMOST = "http://127.0.0.1:18088"
ALLOWED_ORIGIN = "https://launchpad.incubics.com"
SITE_URL = "https://launchpad.incubics.com"
RECURRENCES = {"none", "daily", "weekdays", "weekly", "monthly"}
DURATIONS = {15, 30, 45, 60, 90}
RECENT_MS = 10 * 60 * 1000
EARLY_MS = 30 * 60 * 1000
LATE_MS = 60 * 60 * 1000
IST = ZoneInfo("Asia/Kolkata")
ROOM_LOCK = threading.Lock()
recent = {}


def log(message):
    print(message, flush=True)


def load_email_settings():
    with open(CONFIG_PATH, encoding="utf-8") as handle:
        settings = json.load(handle)["EmailSettings"]
    return settings


def mm(method, path, token, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        MATTERMOST + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        return error.code, detail


def cookie_token(header):
    if not header:
        return ""
    match = re.search(r"(?:^|; )MMAUTHTOKEN=([^;]+)", header)
    return match.group(1) if match else ""


def meeting_from_post(post):
    props = post.get("props") or {}
    raw = props.get("incubics_meeting")
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()
    start_at = int(raw.get("startAt") or 0)
    duration = int(raw.get("durationMin") or 0)
    recurrence = str(raw.get("recurrence") or "none")
    if not title or len(title) > 120 or start_at <= 0:
        return None
    if duration not in DURATIONS or recurrence not in RECURRENCES:
        return None
    join_token = str(raw.get("joinToken") or "")
    if join_token and not re.fullmatch(r"[a-z0-9]{12}", join_token):
        return None
    return {
        "title": title,
        "startAt": start_at,
        "durationMin": duration,
        "recurrence": recurrence,
        "joinToken": join_token,
    }


def ics_escape(value):
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def ics_stamp(ms):
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(ms / 1000))


def rrule(recurrence):
    if recurrence == "daily":
        return "FREQ=DAILY"
    if recurrence == "weekdays":
        return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    if recurrence == "weekly":
        return "FREQ=WEEKLY"
    if recurrence == "monthly":
        return "FREQ=MONTHLY"
    return ""


def recurrence_label(recurrence):
    return {
        "none": "Does not repeat",
        "daily": "Daily",
        "weekdays": "Every weekday",
        "weekly": "Weekly",
        "monthly": "Monthly",
    }.get(recurrence, "Does not repeat")


def channel_link(token, channel_id):
    status, channel = mm("GET", "/api/v4/channels/" + channel_id, token)
    if status != 200 or not isinstance(channel, dict):
        return ""
    team_id = str(channel.get("team_id") or "")
    channel_name = str(channel.get("name") or "")
    if not team_id or not channel_name:
        return ""
    status, team = mm("GET", "/api/v4/teams/" + team_id, token)
    if status != 200 or not isinstance(team, dict):
        return ""
    team_name = str(team.get("name") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", team_name) or not re.fullmatch(r"[A-Za-z0-9_-]+", channel_name):
        return ""
    return SITE_URL + "/" + urllib.parse.quote(team_name, safe="") + "/channels/" + urllib.parse.quote(channel_name, safe="") + "?join=call"


def unfold(text):
    return re.sub(r"\r\n[ \t]", "", text)


def fold(line):
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks = []
    used = 0
    while used < len(line):
        width = 75 if not chunks else 74
        chunks.append((" " if chunks else "") + line[used : used + width])
        used += width
    return "\r\n".join(chunks)


def build_ics(meeting, organizer, attendees, uid, link):
    end = meeting["startAt"] + meeting["durationMin"] * 60000
    description = "Scheduled in a channel on Incubics Launchpad. " + recurrence_label(meeting["recurrence"])
    if link:
        description += "\nJoin meeting: " + link
    lines = [
        "BEGIN:VCALENDAR",
        "PRODID:-//Incubics//Launchpad//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        "UID:" + uid,
        "DTSTAMP:" + ics_stamp(time.time() * 1000),
        "DTSTART:" + ics_stamp(meeting["startAt"]),
        "DTEND:" + ics_stamp(end),
        "SUMMARY:" + ics_escape(meeting["title"]),
        "DESCRIPTION:" + ics_escape(description),
    ]
    if link:
        lines.append("URL:" + ics_escape(link))
    lines.extend([
        "ORGANIZER;CN=" + ics_escape(organizer["name"]) + ":mailto:" + organizer["email"],
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
    ])
    rule = rrule(meeting["recurrence"])
    if rule:
        lines.append("RRULE:" + rule)
    for person in attendees:
        lines.append(
            "ATTENDEE;CN="
            + ics_escape(person["name"])
            + ";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:"
            + person["email"]
        )
    lines.extend(["END:VEVENT", "END:VCALENDAR"])
    return "\r\n".join(fold(line) for line in lines) + "\r\n"


def person_name(user):
    full = " ".join(part for part in [user.get("first_name") or "", user.get("last_name") or ""] if part).strip()
    return full or user.get("username") or user.get("email") or "Incubics"


def channel_people(token, channel_id):
    people = []
    page = 0
    while page < 20:
        status, members = mm(
            "GET",
            "/api/v4/channels/" + channel_id + "/members?page=%d&per_page=200" % page,
            token,
        )
        if status != 200 or not isinstance(members, list):
            return status, []
        if not members:
            break
        for member in members:
            user_status, user = mm("GET", "/api/v4/users/" + member.get("user_id", ""), token)
            if user_status != 200 or not isinstance(user, dict):
                continue
            if user.get("delete_at") or user.get("is_bot"):
                continue
            email = str(user.get("email") or "").strip()
            if not email or "@" not in email:
                continue
            people.append({"id": user["id"], "email": email, "name": person_name(user)})
        if len(members) < 200:
            break
        page += 1
    return 200, people


def send_messages(settings, meeting, organizer, attendees, uid, link):
    ics = build_ics(meeting, organizer, attendees, uid, link)
    flat = unfold(ics)
    has_url = bool(link) and ("URL:" + link) in flat and link in flat.split("DESCRIPTION:", 1)[-1]
    log("invite-ics has_url=%s" % ("yes" if has_url else "no"))
    when = time.strftime("%d %b %Y, %H:%M UTC", time.gmtime(meeting["startAt"] / 1000))
    plain = (
        organizer["name"]
        + " scheduled \""
        + meeting["title"]
        + "\".\n\n"
        + when
        + " · "
        + str(meeting["durationMin"])
        + " min · "
        + recurrence_label(meeting["recurrence"])
        + ("\n\nJoin meeting: " + link if link else "")
        + "\n\nOpen the attached invite to add it to your calendar."
    )
    host = settings.get("SMTPServer")
    port = int(settings.get("SMTPPort") or 587)
    username = settings.get("SMTPUsername") or ""
    password = settings.get("SMTPPassword") or ""
    security = settings.get("ConnectionSecurity") or ""
    from_email = settings.get("FeedbackEmail") or organizer["email"]
    from_name = settings.get("FeedbackName") or "Incubics Launchpad"
    sent = 0
    failed = 0
    context = ssl.create_default_context()
    if security == "TLS":
        client = __import__("smtplib").SMTP_SSL(host, port, timeout=20, context=context)
    else:
        client = __import__("smtplib").SMTP(host, port, timeout=20)
        client.ehlo()
        if security == "STARTTLS":
            client.starttls(context=context)
            client.ehlo()
    try:
        if settings.get("EnableSMTPAuth") and username:
            client.login(username, password)
        for person in attendees:
            message = EmailMessage()
            message["Subject"] = "Meeting: " + meeting["title"]
            message["From"] = formataddr((from_name, from_email))
            message["To"] = formataddr((person["name"], person["email"]))
            message["Reply-To"] = organizer["email"]
            message.set_content(plain)
            message.add_alternative(ics, subtype="calendar", params={"method": "REQUEST", "charset": "UTF-8"})
            try:
                client.send_message(message)
                sent += 1
            except Exception as error:
                failed += 1
                log("invite-recipient-failed " + type(error).__name__)
    finally:
        try:
            client.quit()
        except Exception:
            pass
    return sent, failed


def ist_parts(ms):
    return datetime.fromtimestamp(ms / 1000, IST)


def at_ist(year, month, day, hour, minute):
    return int(datetime(year, month, day, hour, minute, tzinfo=IST).timestamp() * 1000)


def add_days(ms, days):
    current = ist_parts(ms)
    shifted = current.date() + timedelta(days=days)
    return at_ist(shifted.year, shifted.month, shifted.day, current.hour, current.minute)


def add_months(ms, count):
    current = ist_parts(ms)
    month_index = (current.month - 1) + count
    year = current.year + (month_index // 12)
    month = (month_index % 12) + 1
    day = min(current.day, calendar.monthrange(year, month)[1])
    return at_ist(year, month, day, current.hour, current.minute)


def advance_start(ms, recurrence):
    if recurrence == "daily":
        return add_days(ms, 1)
    if recurrence == "weekly":
        return add_days(ms, 7)
    if recurrence == "monthly":
        return add_months(ms, 1)
    if recurrence == "weekdays":
        nxt = add_days(ms, 1)
        guard = 0
        while ist_parts(nxt).weekday() >= 5 and guard < 4:
            nxt = add_days(nxt, 1)
            guard += 1
        return nxt
    return None


def occurrence_start(room, now):
    start = int(room["startAt"])
    duration = int(room["durationMin"]) * 60000
    recurrence = room.get("recurrence") or "none"
    if recurrence == "none":
        if start - EARLY_MS <= now <= start + duration + LATE_MS:
            return start
        return None
    cursor = start
    for _ in range(500):
        if cursor - EARLY_MS <= now <= cursor + duration + LATE_MS:
            return cursor
        if cursor > now:
            return None
        nxt = advance_start(cursor, recurrence)
        if not nxt or nxt <= cursor:
            return None
        cursor = nxt
    return None


def window_open(room, now):
    return occurrence_start(room, now) is not None


def room_over(room, now):
    if (room.get("recurrence") or "none") != "none":
        return False
    end = int(room["startAt"]) + int(room["durationMin"]) * 60000 + LATE_MS
    return now > end


def format_when(ms):
    current = ist_parts(ms)
    hour = current.strftime("%I").lstrip("0") or "12"
    return current.strftime("%a, ") + str(current.day) + current.strftime(" %b %Y, ") + hour + current.strftime(":%M %p IST")


def html_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def clean_name(value):
    text = re.sub(r"\s+", " ", str(value or "").replace("\x00", "").strip())
    if not text or text.startswith("-") or len(text) > 40:
        return ""
    if not re.fullmatch(r"[\w .'-]+", text, flags=re.UNICODE):
        return ""
    return text


def split_name(name):
    parts = name.split(" ")
    if len(parts) == 1:
        return parts[0][:64], ""
    return parts[0][:64], " ".join(parts[1:])[:64]


def load_rooms():
    try:
        with open(ROOMS_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError):
        log("rooms-unreadable")
        return {}


def save_rooms(rooms):
    raw = json.dumps(rooms).encode()
    temporary = ROOMS_PATH + ".tmp"
    with open(temporary, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, ROOMS_PATH)


def mmctl(args):
    command = ["docker", "exec", "mattermost-mattermost-1", "mmctl", "--local", "--suppress-warnings"]
    command.extend(args)
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=40)
    except (subprocess.TimeoutExpired, OSError):
        return 1, "failed"
    return completed.returncode, (completed.stdout or "") + (completed.stderr or "")


def member_ids(token, channel_id):
    found = []
    page = 0
    while page < 20:
        status, members = mm(
            "GET",
            "/api/v4/channels/" + channel_id + "/members?page=%d&per_page=200" % page,
            token,
        )
        if status != 200 or not isinstance(members, list):
            return status, []
        if not members:
            break
        for member in members:
            user_status, user = mm("GET", "/api/v4/users/" + member.get("user_id", ""), token)
            if user_status != 200 or not isinstance(user, dict):
                continue
            if user.get("delete_at") or user.get("is_bot"):
                continue
            username = str(user.get("username") or "")
            if username.startswith("meetg"):
                continue
            found.append(user["id"])
        if len(members) < 200:
            break
        page += 1
    return 200, found


def prepare_room(user_token, channel_id, meeting, join_token):
    with ROOM_LOCK:
        rooms = load_rooms()
        existing = rooms.get(join_token)
        if existing:
            return existing
        status, source = mm("GET", "/api/v4/channels/" + channel_id, user_token)
        if status != 200 or not isinstance(source, dict):
            raise RuntimeError("source")
        team_id = str(source.get("team_id") or "")
        status, team = mm("GET", "/api/v4/teams/" + team_id, user_token)
        if status != 200 or not isinstance(team, dict):
            raise RuntimeError("team")
        team_name = str(team.get("name") or "")
        if not re.fullmatch(r"[a-z0-9_-]+", team_name):
            raise RuntimeError("team-name")
        channel_name = "meet" + join_token
        created_status, created = mm(
            "POST",
            "/api/v4/channels",
            user_token,
            {
                "team_id": team_id,
                "name": channel_name,
                "display_name": meeting["title"][:64],
                "type": "P",
                "purpose": "Incubics meeting",
                "header": SITE_URL + "/meet/" + join_token,
            },
        )
        if created_status not in (200, 201) or not isinstance(created, dict):
            raise RuntimeError("channel")
        status, ids = member_ids(user_token, channel_id)
        if status == 200:
            for user_id in ids:
                mm(
                    "POST",
                    "/api/v4/channels/" + created["id"] + "/members",
                    user_token,
                    {"user_id": user_id},
                )
        room = {
            "token": join_token,
            "channelId": created["id"],
            "channel": channel_name,
            "team": team_name,
            "title": meeting["title"],
            "startAt": meeting["startAt"],
            "durationMin": meeting["durationMin"],
            "recurrence": meeting["recurrence"],
            "guests": [],
        }
        rooms[join_token] = room
        save_rooms(rooms)
        return room


def meeting_url(user_token, meeting, channel_id):
    join_token = meeting.get("joinToken") or ""
    if not join_token:
        return channel_link(user_token, channel_id)
    room = prepare_room(user_token, channel_id, meeting, join_token)
    return SITE_URL + "/meet/" + room["token"]


def login_user(email, password):
    request = urllib.request.Request(
        MATTERMOST + "/api/v4/users/login",
        data=json.dumps({"login_id": email, "password": password}).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read() or b"{}")
            token = response.headers.get("Token") or ""
            crumbs = response.headers.get_all("Set-Cookie") or []
    except urllib.error.HTTPError:
        return None, "", ""
    csrf = ""
    for crumb in crumbs:
        match = re.match(r"MMCSRF=([^;]+)", crumb)
        if match:
            csrf = match.group(1)
    if token and not csrf:
        probe = urllib.request.Request(
            MATTERMOST + "/api/v4/users/me",
            headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(probe, timeout=20) as response:
                for crumb in response.headers.get_all("Set-Cookie") or []:
                    match = re.match(r"MMCSRF=([^;]+)", crumb)
                    if match:
                        csrf = match.group(1)
        except urllib.error.HTTPError:
            pass
    return body if isinstance(body, dict) else None, token, csrf


def session_cookies(user_id, token, csrf, max_age):
    cookies = [
        "MMAUTHTOKEN=%s; Path=/; Max-Age=%d; Secure; HttpOnly; SameSite=Lax" % (token, max_age),
        "MMUSERID=%s; Path=/; Max-Age=%d; Secure; SameSite=Lax" % (user_id, max_age),
    ]
    if csrf:
        cookies.append("MMCSRF=%s; Path=/; Max-Age=%d; Secure; SameSite=Lax" % (csrf, max_age))
    return cookies


def leave_other_channels(token, allowed_ids):
    if isinstance(allowed_ids, str):
        allowed_ids = {allowed_ids}
    status, channels = mm("GET", "/api/v4/users/me/channels", token)
    if status != 200 or not isinstance(channels, list):
        return
    for channel in channels:
        if not isinstance(channel, dict) or channel.get("id") in allowed_ids:
            continue
        if channel.get("type") in ("D", "G"):
            continue
        mm("DELETE", "/api/v4/channels/" + channel["id"] + "/members/me", token)


def create_external(display_name):
    username = "meetg" + secrets.token_hex(6)
    email = username + "@example.com"
    password = secrets.token_urlsafe(18)
    first, last = split_name(display_name)
    args = [
        "user", "create",
        "--email", email,
        "--username", username,
        "--password", password,
        "--firstname", first,
        "--disable-welcome-email",
        "--email-verified",
    ]
    if last:
        args.extend(["--lastname", last])
    code, output = mmctl(args)
    output = output.replace(password, "***")
    if code != 0:
        log("guest-create-failed")
        return None
    return {"username": username, "email": email, "password": password}


def delete_external(username):
    if not re.fullmatch(r"meetg[a-f0-9]{12}", username or ""):
        return
    mmctl(["user", "delete", username, "--confirm"])


def redirect_path(room, external):
    path = "/" + urllib.parse.quote(room["team"], safe="") + "/channels/" + urllib.parse.quote(room["channel"], safe="") + "?join=call"
    if external:
        path += "&guest=1"
    return path


def render_page(room, status):
    try:
        with open(TEMPLATE_PATH, encoding="utf-8") as handle:
            html = handle.read()
    except OSError:
        html = "<!DOCTYPE html><title>Incubics</title><p>@@NOTE@@</p>"
    if room is None:
        title = "Meeting link"
        when = ""
        note = "This meeting link is not valid."
        open_flag = "no"
        app = "#"
        disabled = "disabled"
        app_class = " is-disabled"
    else:
        start = occurrence_start(room, time.time() * 1000) or int(room["startAt"])
        title = room["title"]
        when = format_when(start) + " · " + str(room["durationMin"]) + " min · " + recurrence_label(room["recurrence"])
        open_flag = "yes" if status == "open" else "no"
        disabled = "" if status == "open" else "disabled"
        app_class = "" if status == "open" else " is-disabled"
        app = "mattermost://" + SITE_URL.split("://", 1)[1] + redirect_path(room, False)
        if status == "open":
            note = "Enter your name to join. If the Mattermost app is installed, you can open it instead."
        elif status == "ended":
            note = "This meeting has ended."
        else:
            note = "You can join from 30 minutes before the start."
    replacements = {
        "@@TITLE@@": html_escape(title),
        "@@WHEN@@": html_escape(when),
        "@@NOTE@@": html_escape(note),
        "@@OPEN@@": open_flag,
        "@@DISABLED@@": disabled,
        "@@APPCLASS@@": app_class,
        "@@APP@@": html_escape(app),
    }
    for key, value in replacements.items():
        html = html.replace(key, value)
    return html


def page_status(room, now):
    if room_over(room, now):
        return "ended"
    if window_open(room, now):
        return "open"
    return "early"


def join_messages(code):
    return {
        "name": "Enter your name to join.",
        "closed": "This meeting is not open right now.",
        "full": "This meeting can't add another person right now.",
        "failed": "The meeting could not be joined.",
    }.get(code, "The meeting could not be joined.")


def add_external(room, display_name, now):
    created = create_external(display_name)
    if not created:
        return "full", None, None
    password = created.pop("password")
    try:
        user, token, csrf = login_user(created["email"], password)
    finally:
        password = ""
    if not user or not token:
        delete_external(created["username"])
        return "failed", None, None
    mm(
        "PUT",
        "/api/v4/users/me/patch",
        token,
        {"notify_props": {"email": "false", "push": "none", "desktop": "none", "desktop_sound": "false"}},
    )
    user_id = user.get("id")
    if user_id:
        mm(
            "PUT",
            "/api/v4/users/me/preferences",
            token,
            [
                {"user_id": user_id, "category": "recommended_next_steps", "name": "hide", "value": "true"},
                {"user_id": user_id, "category": "onboarding_task_list", "name": "onboarding_task_list_show", "value": "false"},
                {"user_id": user_id, "category": "onboarding_task_list", "name": "onboarding_task_list_open", "value": "false"},
                {"user_id": user_id, "category": "tutorial_step", "name": user_id, "value": "999"},
            ],
        )
    team_code, team_output = mmctl(["team", "users", "add", room["team"], created["username"]])
    if team_code != 0 and "already" not in team_output.lower():
        delete_external(created["username"])
        return "full", None, None
    channel_code, channel_output = mmctl([
        "channel", "users", "add",
        room["team"] + ":" + room["channel"],
        created["username"],
    ])
    if channel_code != 0 and "already" not in channel_output.lower():
        delete_external(created["username"])
        return "failed", None, None
    leave_other_channels(token, room["channelId"])
    start = occurrence_start(room, now) or int(room["startAt"])
    until = start + int(room["durationMin"]) * 60000 + LATE_MS
    guest = {"username": created["username"], "userId": user.get("id"), "token": token, "until": until}
    cookies = session_cookies(user.get("id"), token, csrf, max(1800, min(12 * 3600, int((until - now) / 1000))))
    return "ok", guest, cookies


def sweep():
    now = time.time() * 1000
    with ROOM_LOCK:
        _sweep_locked(now)


def _sweep_locked(now):
    rooms = load_rooms()
    for token, room in list(rooms.items()):
        if not room_over(room, now):
            continue
        for guest in room.get("guests") or []:
            delete_external(guest.get("username"))
        mmctl(["channel", "delete", room.get("team", "") + ":" + room.get("channel", ""), "--confirm"])
        rooms.pop(token, None)
    allowed = {}
    tokens = {}
    for room in rooms.values():
        kept = []
        for guest in room.get("guests") or []:
            username = guest.get("username") or ""
            if now > int(guest.get("until") or 0):
                delete_external(username)
                continue
            kept.append(guest)
            allowed.setdefault(username, set()).add(room.get("channelId"))
            if guest.get("token"):
                tokens[username] = guest["token"]
        room["guests"] = kept
    for username, channel_ids in allowed.items():
        if tokens.get(username):
            leave_other_channels(tokens[username], channel_ids)
    save_rooms(rooms)


def sweep_loop():
    while True:
        time.sleep(20)
        try:
            sweep()
        except Exception as error:
            log("sweep-failed " + type(error).__name__)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log("http " + (fmt % args))

    def send_json(self, status, payload, cookies=None):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        for item in cookies or []:
            self.send_header("Set-Cookie", item)
        self.end_headers()
        self.wfile.write(raw)

    def send_html(self, status, html):
        raw = html.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.end_headers()
        self.wfile.write(raw)

    def meet_token(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        match = re.fullmatch(r"/meet/([a-z0-9]{12})(/join)?", path)
        if not match:
            return "", False
        return match.group(1), bool(match.group(2))

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        token, joining = self.meet_token()
        if not token or joining:
            self.send_html(404, render_page(None, "missing"))
            return
        with ROOM_LOCK:
            room = load_rooms().get(token)
        if not room:
            self.send_html(404, render_page(None, "missing"))
            return
        self.send_html(200, render_page(room, page_status(room, time.time() * 1000)))

    def do_POST(self):
        token, joining = self.meet_token()
        if token and joining:
            self.join_meeting(token)
            return
        if self.path != "/invite":
            self.send_json(404, {"error": "not-found"})
            return
        origin = self.headers.get("Origin", "")
        if origin and origin != ALLOWED_ORIGIN:
            self.send_json(403, {"error": "origin"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 4000:
            self.send_json(400, {"error": "body"})
            return
        try:
            incoming = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(400, {"error": "json"})
            return
        token = cookie_token(self.headers.get("Cookie"))
        if not token:
            self.send_json(401, {"error": "auth"})
            return
        channel_id = str(incoming.get("channel_id") or "")
        post_id = str(incoming.get("post_id") or "")
        if not re.fullmatch(r"[a-z0-9]{26}", channel_id) or not re.fullmatch(r"[a-z0-9]{26}", post_id):
            self.send_json(400, {"error": "id"})
            return
        status, me = mm("GET", "/api/v4/users/me", token)
        if status != 200 or not isinstance(me, dict):
            self.send_json(401, {"error": "auth"})
            return
        now = time.time()
        stamps = [stamp for stamp in recent.get(me["id"], []) if now - stamp < 600]
        if len(stamps) >= 12:
            self.send_json(429, {"error": "rate"})
            return
        status, post = mm("GET", "/api/v4/posts/" + post_id, token)
        if status != 200 or not isinstance(post, dict):
            self.send_json(404, {"error": "post"})
            return
        if post.get("channel_id") != channel_id or post.get("user_id") != me["id"]:
            self.send_json(403, {"error": "post"})
            return
        if abs((time.time() * 1000) - int(post.get("create_at") or 0)) > RECENT_MS:
            self.send_json(409, {"error": "stale"})
            return
        try:
            meeting = meeting_from_post(post)
        except (TypeError, ValueError, json.JSONDecodeError):
            meeting = None
        if not meeting:
            self.send_json(400, {"error": "meeting"})
            return
        status, people = channel_people(token, channel_id)
        if status != 200:
            self.send_json(403, {"error": "channel"})
            return
        if not any(person["id"] == me["id"] for person in people):
            email = str(me.get("email") or "").strip()
            if email:
                people.append({"id": me["id"], "email": email, "name": person_name(me)})
        organizer = next((person for person in people if person["id"] == me["id"]), None)
        if organizer is None:
            organizer = {
                "email": load_email_settings().get("FeedbackEmail") or "launchpad@incubics.com",
                "name": person_name(me),
            }
        stamps.append(now)
        recent[me["id"]] = stamps
        try:
            link = meeting_url(token, meeting, channel_id)
        except Exception as error:
            log("room-failed " + type(error).__name__)
            self.send_json(502, {"error": "room", "sent": 0, "failed": 0})
            return
        if meeting.get("joinToken") and not link:
            self.send_json(502, {"error": "room", "sent": 0, "failed": 0})
            return
        try:
            sent, failed = send_messages(
                load_email_settings(),
                meeting,
                organizer,
                people,
                "incubics-meeting-" + post_id + "@launchpad.incubics.com",
                link,
            )
        except Exception as error:
            log("invite-smtp-failed " + type(error).__name__)
            self.send_json(502, {"error": "smtp", "sent": 0, "failed": len(people)})
            return
        skipped = 0
        log("invite-sent post=%s sent=%d failed=%d" % (post_id, sent, failed))
        self.send_json(200, {"sent": sent, "failed": failed, "skipped": skipped})

    def join_meeting(self, token):
        origin = self.headers.get("Origin", "")
        if origin and origin != ALLOWED_ORIGIN:
            self.send_json(403, {"error": "origin", "message": join_messages("failed")})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > 2000:
            self.send_json(400, {"error": "body", "message": join_messages("failed")})
            return
        try:
            incoming = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
        except json.JSONDecodeError:
            self.send_json(400, {"error": "json", "message": join_messages("failed")})
            return
        now = time.time() * 1000
        with ROOM_LOCK:
            room = load_rooms().get(token)
        if not room:
            self.send_json(404, {"error": "missing", "message": "This meeting link is not valid."})
            return
        if not window_open(room, now):
            self.send_json(409, {"error": "closed", "message": join_messages("closed")})
            return
        session = cookie_token(self.headers.get("Cookie"))
        member = None
        if session:
            status, me = mm("GET", "/api/v4/users/me", session)
            if status == 200 and isinstance(me, dict) and not me.get("delete_at"):
                member = me
        if member:
            external = str(member.get("username") or "").startswith("meetg")
            code, output = mmctl(["channel", "users", "add", room["team"] + ":" + room["channel"], member["username"]])
            if code != 0 and "already" not in output.lower():
                self.send_json(403, {"error": "channel", "message": join_messages("failed")})
                return
            if external:
                start = occurrence_start(room, now) or int(room["startAt"])
                until = start + int(room["durationMin"]) * 60000 + LATE_MS
                with ROOM_LOCK:
                    rooms = load_rooms()
                    saved = rooms.get(token)
                    if saved is not None:
                        guests = saved.setdefault("guests", [])
                        if not any(guest.get("userId") == member.get("id") for guest in guests):
                            guests.append({
                                "username": member.get("username"),
                                "userId": member.get("id"),
                                "token": session,
                                "until": until,
                            })
                            save_rooms(rooms)
                leave_other_channels(session, room["channelId"])
            self.send_json(200, {"redirect": redirect_path(room, external)})
            return
        name = clean_name((incoming or {}).get("name"))
        if not name:
            self.send_json(400, {"error": "name", "message": join_messages("name")})
            return
        with ROOM_LOCK:
            current = load_rooms().get(token) or room
            active = [guest for guest in current.get("guests") or [] if now <= int(guest.get("until") or 0)]
        if len(active) >= 20:
            self.send_json(429, {"error": "full", "message": join_messages("full")})
            return
        result, guest, cookies = add_external(current, name, now)
        if result != "ok":
            self.send_json(502 if result == "failed" else 429, {"error": result, "message": join_messages(result)})
            return
        with ROOM_LOCK:
            rooms = load_rooms()
            saved = rooms.get(token)
            if not saved:
                delete_external(guest.get("username"))
                self.send_json(404, {"error": "missing", "message": "This meeting link is not valid."})
                return
            saved.setdefault("guests", []).append(guest)
            rooms[token] = saved
            save_rooms(rooms)
        log("join-external token=%s" % token)
        self.send_json(200, {"redirect": redirect_path(saved, True)}, cookies)


def main():
    threading.Thread(target=sweep_loop, name="meeting-sweep", daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 18089), Handler)
    log("meeting-invite listening on 127.0.0.1:18089")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
