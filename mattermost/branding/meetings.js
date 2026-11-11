(function () {
  if (window.top !== window.self) return;
  if (window.__incubicsMeetings) return;
  window.__incubicsMeetings = true;

  var loadedKey = "";
  var meetings = [];
  var current = null;
  var loadGen = 0;

  function channelRoute() {
    var match = window.location.pathname.match(/^\/([^/]+)\/channels\/([^/]+)/);
    if (!match || match[1] === "plugins") return null;
    return {team: decodeURIComponent(match[1]), channel: decodeURIComponent(match[2])};
  }

  function csrf() {
    var match = document.cookie.match(/(?:^|; )MMCSRF=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function api(path, options) {
    options = options || {};
    var headers = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"};
    var token = csrf();
    if (token) headers["X-CSRF-Token"] = token;
    if (options.body) headers["Content-Type"] = "application/json";
    return fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      if (response.status === 204) return null;
      return response.json();
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[ch];
    });
  }

  function pad(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function parts(ms) {
    var out = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23"
    }).formatToParts(new Date(ms)).forEach(function (part) {
      out[part.type] = part.value;
    });
    return out;
  }

  function atIst(year, month, day, hour, minute) {
    return Date.parse(year + "-" + pad(month) + "-" + pad(day) + "T" + pad(hour) + ":" + pad(minute) + ":00+05:30");
  }

  function addDays(ms, days) {
    var when = parts(ms);
    var shifted = new Date(Date.UTC(+when.year, +when.month - 1, +when.day + days));
    return atIst(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), +when.hour, +when.minute);
  }

  function addMonths(ms, count) {
    var when = parts(ms);
    var monthIndex = (+when.month - 1) + count;
    var year = +when.year + Math.floor(monthIndex / 12);
    var month = monthIndex % 12;
    if (month < 0) {
      month += 12;
      year -= 1;
    }
    var last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    var day = Math.min(+when.day, last);
    return atIst(year, month + 1, day, +when.hour, +when.minute);
  }

  function weekend(ms) {
    var day = parts(ms).weekday;
    return day === "Sat" || day === "Sun";
  }

  function advance(ms, recurrence) {
    if (recurrence === "daily") return addDays(ms, 1);
    if (recurrence === "weekly") return addDays(ms, 7);
    if (recurrence === "monthly") return addMonths(ms, 1);
    if (recurrence === "weekdays") {
      var next = addDays(ms, 1);
      var guard = 0;
      while (weekend(next) && guard < 4) {
        next = addDays(next, 1);
        guard += 1;
      }
      return next;
    }
    return null;
  }

  function recurrenceLabel(value) {
    return {
      none: "Does not repeat",
      daily: "Daily",
      weekdays: "Every weekday",
      weekly: "Weekly",
      monthly: "Monthly"
    }[value] || "Does not repeat";
  }

  function formatWhen(ms) {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(new Date(ms)) + " IST";
  }

  function nextOccurrence(meeting, now) {
    var duration = (meeting.durationMin || 30) * 60000;
    var cursor = meeting.startAt;
    if (!cursor) return null;
    if (meeting.recurrence === "none" || !meeting.recurrence) {
      return cursor + duration < now ? null : cursor;
    }
    var guard = 0;
    while (cursor + duration < now && guard < 500) {
      var following = advance(cursor, meeting.recurrence);
      if (!following || following <= cursor) return null;
      cursor = following;
      guard += 1;
    }
    return cursor;
  }

  function readMeeting(post) {
    var raw = post && post.props && post.props.incubics_meeting;
    if (!raw || post.delete_at) return null;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (err) { return null; }
    }
    if (!raw || !raw.title || !raw.startAt) return null;
    return {
      postId: post.id,
      userId: post.user_id,
      title: String(raw.title),
      startAt: Number(raw.startAt),
      durationMin: Number(raw.durationMin) || 30,
      recurrence: raw.recurrence || "none"
    };
  }

  function header() {
    return document.querySelector("#channel-header") || document.querySelector(".channel-header:not(.alt)");
  }

  function channelBox() {
    return document.querySelector("#channel_view") ||
      document.querySelector(".channel-view") ||
      (header() && header().parentElement);
  }

  function meetingsActive() {
    var button = document.querySelector('#incubics-channel-tabs [data-tab="meetings"]');
    return !!(button && button.classList.contains("is-active"));
  }

  function ensurePane() {
    var pane = document.getElementById("incubics-meetings-pane");
    if (pane) return pane;
    pane = document.createElement("div");
    pane.id = "incubics-meetings-pane";
    pane.innerHTML = '<div class="incubics-meetings-bar"><h2>Meetings</h2><button type="button" data-schedule>Schedule a meeting</button></div>' +
      '<p class="incubics-meetings-note" hidden></p>' +
      '<div class="incubics-meetings-list"></div>';
    pane.addEventListener("click", function (event) {
      event.stopPropagation();
      if (event.target.closest("[data-schedule]")) openDialog();
      var cancel = event.target.closest("[data-cancel]");
      if (cancel) removeMeeting(cancel.getAttribute("data-cancel"));
    });
    document.body.appendChild(pane);
    return pane;
  }

  function formMarkup() {
    return '<h2>Schedule a meeting</h2>' +
      '<p class="incubics-meeting-dialog-lead">Choose a one-time meeting or a repeat. Everyone in this channel receives a calendar invite.</p>' +
      '<label>Title<input name="title" type="text" maxlength="120" required placeholder="Sprint review"></label>' +
      '<label>Date<input name="date" type="date" required></label>' +
      '<label>Time<input name="time" type="time" required></label>' +
      '<label>Length<select name="duration"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option></select></label>' +
      '<label>Repeat<select name="recurrence"><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekdays">Every weekday</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>' +
      '<p class="incubics-meetings-note" hidden></p>' +
      '<div class="incubics-meetings-actions"><button type="submit">Send invite</button><button type="button" data-close>Close</button></div>';
  }

  function ensureDialog() {
    var dialog = document.getElementById("incubics-meeting-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "incubics-meeting-dialog";
    dialog.hidden = true;
    dialog.innerHTML = '<form class="incubics-meeting-dialog-form">' + formMarkup() + '</form>';
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog || event.target.hasAttribute("data-close")) dialog.hidden = true;
    });
    dialog.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveMeeting(new FormData(event.currentTarget));
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function setDialogNote(text) {
    var note = document.querySelector("#incubics-meeting-dialog .incubics-meetings-note");
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || "";
  }

  function openDialog() {
    var route = channelRoute();
    if (!route) return;
    var dialog = ensureDialog();
    dialog.hidden = false;
    var form = dialog.querySelector("form");
    var title = form.elements.title;
    if (title && !title.value) title.focus();
  }

  function ensureHeaderButton() {
    var bar = document.querySelector("#channel-header") || document.querySelector(".channel-header");
    if (!bar) return;
    var icons = bar.querySelector(".channel-header__icons") || bar.querySelector(".channel-header__top") || bar;
    var button = document.getElementById("incubics-schedule-meeting");
    if (!button) {
      button = document.createElement("button");
      button.id = "incubics-schedule-meeting";
      button.type = "button";
      button.textContent = "Schedule meeting";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openDialog();
      });
    }
    if (button.parentElement !== icons) icons.appendChild(button);
  }

  function removeHeaderButton() {
    var button = document.getElementById("incubics-schedule-meeting");
    if (button) button.remove();
  }

  function setNote(text) {
    var note = document.querySelector("#incubics-meetings-pane .incubics-meetings-note");
    if (!note) return;
    note.hidden = !text;
    note.textContent = text || "";
  }

  function place(pane) {
    var box = channelBox();
    var bar = document.getElementById("incubics-channel-tabs");
    if (!box) return;
    var rect = box.getBoundingClientRect();
    var top = bar ? bar.getBoundingClientRect().bottom : rect.top;
    if (top < rect.top) top = rect.top;
    if (top > rect.bottom - 80) top = rect.top;
    pane.style.left = Math.max(0, rect.left) + "px";
    pane.style.top = top + "px";
    pane.style.width = Math.max(0, rect.width) + "px";
    pane.style.height = Math.max(120, rect.bottom - top) + "px";
  }

  function hide() {
    document.body.classList.remove("incubics-meetings-on");
    var pane = document.getElementById("incubics-meetings-pane");
    if (pane) pane.remove();
    var dialog = document.getElementById("incubics-meeting-dialog");
    if (dialog) dialog.hidden = true;
    loadedKey = "";
    meetings = [];
    current = null;
  }

  function renderList() {
    var pane = document.getElementById("incubics-meetings-pane");
    if (!pane) return;
    var list = pane.querySelector(".incubics-meetings-list");
    var now = Date.now();
    var rows = meetings.map(function (meeting) {
      return {meeting: meeting, when: nextOccurrence(meeting, now)};
    }).filter(function (row) { return row.when; }).sort(function (a, b) { return a.when - b.when; });
    if (!rows.length) {
      list.innerHTML = '<p class="incubics-meetings-empty">No upcoming meetings in this channel.</p>';
      return;
    }
    list.innerHTML = rows.map(function (row) {
      var meeting = row.meeting;
      return '<article class="incubics-meeting-card"><div><strong>' + escapeHtml(meeting.title) + '</strong><p>' +
        escapeHtml(formatWhen(row.when)) + " · " + meeting.durationMin + " min · " + escapeHtml(recurrenceLabel(meeting.recurrence)) +
        '</p></div><button type="button" class="incubics-meeting-cancel" data-cancel="' + escapeHtml(meeting.postId) + '">Cancel</button></article>';
    }).join("");
  }

  function collect(posts) {
    var byId = {};
    (posts || []).forEach(function (post) {
      var meeting = readMeeting(post);
      if (meeting) byId[meeting.postId] = meeting;
    });
    meetings = Object.keys(byId).map(function (id) { return byId[id]; });
    renderList();
  }

  function load(route) {
    var key = route.team + "/" + route.channel;
    if (loadedKey === key && current) {
      renderList();
      return;
    }
    loadedKey = key;
    var gen = ++loadGen;
    setNote("Loading meetings…");
    api("/api/v4/teams/name/" + encodeURIComponent(route.team)).then(function (team) {
      return api("/api/v4/teams/" + team.id + "/channels/name/" + encodeURIComponent(route.channel)).then(function (channel) {
        current = {key: key, team: team, channel: channel};
        return Promise.all([
          api("/api/v4/channels/" + channel.id + "/pinned").catch(function () { return []; }),
          api("/api/v4/channels/" + channel.id + "/posts?per_page=100")
        ]);
      });
    }).then(function (result) {
      if (gen !== loadGen || !current || current.key !== key) return;
      var pinned = Array.isArray(result[0]) ? result[0] : [];
      var recent = result[1] && result[1].posts ? Object.keys(result[1].posts).map(function (id) { return result[1].posts[id]; }) : [];
      collect(pinned.concat(recent));
      setNote("");
    }).catch(function () {
      if (loadedKey !== key) return;
      setNote("Meetings could not be loaded.");
    });
  }

  function ensureChannel() {
    var route = channelRoute();
    if (!route) return Promise.reject(new Error("route"));
    var key = route.team + "/" + route.channel;
    if (current && current.key === key) return Promise.resolve(current);
    return api("/api/v4/teams/name/" + encodeURIComponent(route.team)).then(function (team) {
      return api("/api/v4/teams/" + team.id + "/channels/name/" + encodeURIComponent(route.channel)).then(function (channel) {
        current = {key: key, team: team, channel: channel};
        return current;
      });
    });
  }

  function icsEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function icsStamp(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function rrule(recurrence) {
    if (recurrence === "daily") return "FREQ=DAILY";
    if (recurrence === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    if (recurrence === "weekly") return "FREQ=WEEKLY";
    if (recurrence === "monthly") return "FREQ=MONTHLY";
    return "";
  }

  function buildIcs(meeting, uid) {
    var lines = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Incubics//Launchpad//EN",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + icsStamp(Date.now()),
      "DTSTART:" + icsStamp(meeting.startAt),
      "DTEND:" + icsStamp(meeting.startAt + meeting.durationMin * 60000),
      "SUMMARY:" + icsEscape(meeting.title),
      "DESCRIPTION:" + icsEscape(recurrenceLabel(meeting.recurrence) + ". Scheduled in this channel.")
    ];
    var rule = rrule(meeting.recurrence);
    if (rule) lines.push("RRULE:" + rule);
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function uploadIcs(channelId, filename, text) {
    var body = new FormData();
    body.append("channel_id", channelId);
    body.append("files", new Blob([text], {type: "text/calendar"}), filename);
    var headers = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"};
    var token = csrf();
    if (token) headers["X-CSRF-Token"] = token;
    return fetch("/api/v4/files", {method: "POST", credentials: "same-origin", headers: headers, body: body}).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    }).then(function (payload) {
      var infos = payload.file_infos || [];
      return infos.length ? infos[0].id : "";
    });
  }

  function inviteNote(result) {
    if (!result) return "Scheduled in the channel. The calendar invite email could not be sent.";
    if (result.sent > 0 && !result.failed) return "Scheduled. A calendar invite was emailed to " + result.sent + (result.sent === 1 ? " person" : " people") + " in this channel.";
    if (result.sent > 0) return "Scheduled. Calendar invites were emailed to " + result.sent + " people. " + result.failed + " could not be delivered.";
    if (!result.failed) return "Scheduled in the channel. Nobody in this channel has an email address, so no calendar invite was sent.";
    return "Scheduled in the channel. The calendar invite could not be delivered.";
  }

  function saveMeeting(form) {
    var title = String(form.get("title") || "").trim();
    var date = String(form.get("date") || "");
    var time = String(form.get("time") || "");
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    var clock = /^(\d{2}):(\d{2})$/.exec(time);
    if (!title || !match || !clock) {
      setDialogNote("Add a title, date, and time.");
      return;
    }
    var startAt = atIst(+match[1], +match[2], +match[3], +clock[1], +clock[2]);
    if (!startAt || startAt < Date.now() - 60000) {
      setDialogNote("Choose a time that is still ahead.");
      return;
    }
    var meeting = {
      title: title,
      startAt: startAt,
      durationMin: Number(form.get("duration")) || 30,
      recurrence: String(form.get("recurrence") || "none")
    };
    var message = "Meeting: " + meeting.title + "\n" + formatWhen(meeting.startAt) + " · " + meeting.durationMin + " min · " + recurrenceLabel(meeting.recurrence) + "\nA calendar invite is being emailed to this channel.";
    loadGen += 1;
    setDialogNote("Sending the calendar invite…");
    ensureChannel().then(function (context) {
      var filename = meeting.title.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "meeting";
      return uploadIcs(context.channel.id, filename + ".ics", buildIcs(meeting, "incubics-" + Date.now() + "@launchpad.incubics.com")).catch(function () {
        return "";
      }).then(function (fileId) {
        var body = {channel_id: context.channel.id, message: message, props: {incubics_meeting: meeting}};
        if (fileId) body.file_ids = [fileId];
        return api("/api/v4/posts", {method: "POST", body: body});
      });
    }).then(function (post) {
      return api("/api/v4/posts/" + post.id + "/pin", {method: "POST"}).catch(function () { return post; }).then(function () {
        return api("/brand/meeting-invite", {method: "POST", body: {channel_id: post.channel_id, post_id: post.id}}).then(function (result) {
          return {post: post, result: result};
        }).catch(function () {
          return {post: post, result: null};
        });
      });
    }).then(function (saved) {
      var post = saved.post;
      var item = readMeeting(post) || Object.assign({postId: post.id, userId: post.user_id}, meeting);
      meetings.push(item);
      var dialog = document.getElementById("incubics-meeting-dialog");
      if (dialog) dialog.querySelector("form").reset();
      renderList();
      setNote(inviteNote(saved.result));
      setDialogNote(inviteNote(saved.result));
    }).catch(function () {
      setDialogNote("The meeting could not be scheduled.");
    });
  }

  function removeMeeting(postId) {
    setNote("Cancelling the meeting…");
    api("/api/v4/posts/" + postId, {method: "DELETE"}).then(function () {
      meetings = meetings.filter(function (meeting) { return meeting.postId !== postId; });
      renderList();
      setNote("The meeting was cancelled.");
    }).catch(function () {
      setNote("Only the person who scheduled this meeting can cancel it.");
    });
  }

  function paint() {
    var route = channelRoute();
    if (!route) {
      removeHeaderButton();
      if (document.body.classList.contains("incubics-meetings-on") || document.getElementById("incubics-meeting-dialog")) hide();
      return;
    }
    ensureHeaderButton();
    if (!meetingsActive()) {
      if (document.body.classList.contains("incubics-meetings-on")) {
        document.body.classList.remove("incubics-meetings-on");
        var pane = document.getElementById("incubics-meetings-pane");
        if (pane) pane.remove();
      }
      return;
    }
    var pane = ensurePane();
    document.body.classList.add("incubics-meetings-on");
    place(pane);
    load(route);
  }

  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      paint();
    }, 80);
  }

  window.addEventListener("resize", function () {
    var pane = document.getElementById("incubics-meetings-pane");
    if (pane && document.body.classList.contains("incubics-meetings-on")) place(pane);
  });
  var observer = new MutationObserver(queue);
  function start() {
    queue();
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
