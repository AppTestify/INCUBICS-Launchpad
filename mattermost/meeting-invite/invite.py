#!/usr/bin/env python3
"""Email a calendar invite to every member of a channel meeting."""

import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG_PATH = "/opt/mattermost/volumes/app/mattermost/config/config.json"
MATTERMOST = "http://127.0.0.1:18088"
ALLOWED_ORIGIN = "https://launchpad.incubics.com"
SITE_URL = "https://launchpad.incubics.com"
RECURRENCES = {"none", "daily", "weekdays", "weekly", "monthly"}
DURATIONS = {15, 30, 45, 60, 90}
RECENT_MS = 10 * 60 * 1000
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
            "Cookie": "MMAUTHTOKEN=" + token,
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
    return {
        "title": title,
        "startAt": start_at,
        "durationMin": duration,
        "recurrence": recurrence,
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
    return SITE_URL + "/" + urllib.parse.quote(team_name, safe="") + "/channels/" + urllib.parse.quote(channel_name, safe="")


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
        description += "\nJoin: " + link
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
        + ("\n\nJoin: " + link if link else "")
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


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log("http " + (fmt % args))

    def send_json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"error": "not-found"})

    def do_POST(self):
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
        link = channel_link(token, channel_id)
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


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 18089), Handler)
    log("meeting-invite listening on 127.0.0.1:18089")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
