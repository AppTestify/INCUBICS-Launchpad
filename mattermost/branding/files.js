(function () {
  function appFrame() {
    if (window.top === window.self) return true;
    try {
      return window.top.location.host !== window.location.host;
    } catch (error) {
      return true;
    }
  }
  if (!appFrame()) return;
  if (window.__incubicsFiles) return;
  window.__incubicsFiles = true;

  var loadedKey = "";
  var loadGen = 0;
  var current = null;
  var listed = {};

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

  function header() {
    return document.querySelector("#channel-header") || document.querySelector(".channel-header:not(.alt)");
  }

  function channelBox() {
    return document.querySelector("#channel_view") ||
      document.querySelector(".channel-view") ||
      (header() && header().parentElement);
  }

  function sessionToken() {
    try {
      var preferred = ["token", "MMAUTHTOKEN", "MMTOKEN"];
      var index;
      for (index = 0; index < preferred.length; index++) {
        var direct = localStorage.getItem(preferred[index]);
        if (direct) return direct;
      }
      var keys = Object.keys(localStorage);
      for (index = 0; index < keys.length; index++) {
        if (!/token/i.test(keys[index])) continue;
        var value = localStorage.getItem(keys[index]) || "";
        if (/^[a-z0-9]{26}$/.test(value)) return value;
      }
    } catch (err) {}
    return "";
  }

  function fileHeaders() {
    var headers = {"Accept": "*/*", "X-Requested-With": "XMLHttpRequest"};
    var token = csrf();
    if (token) headers["X-CSRF-Token"] = token;
    var session = sessionToken();
    if (session) headers.Authorization = "Bearer " + session;
    return headers;
  }

  function filesActive() {
    var button = document.querySelector('#incubics-channel-tabs [data-tab="files"]');
    return !!(button && button.classList.contains("is-active"));
  }

  function ensureTab() {
    var bar = document.getElementById("incubics-channel-tabs");
    if (!bar || bar.querySelector('[data-tab="files"]')) return;
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-tab", "files");
    button.textContent = "Files";
    var meetings = bar.querySelector('[data-tab="meetings"]');
    if (meetings) meetings.insertAdjacentElement("afterend", button);
    else bar.appendChild(button);
  }

  function formatSize(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + " B";
    if (size < 1048576) return (size / 1024).toFixed(size < 10240 ? 1 : 0) + " KB";
    return (size / 1048576).toFixed(1) + " MB";
  }

  function formatWhen(ms) {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      }).format(new Date(ms));
    } catch (err) {
      return "";
    }
  }

  function setNote(text) {
    var note = document.querySelector("#incubics-files-pane .incubics-files-note");
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

  function ensurePane() {
    var pane = document.getElementById("incubics-files-pane");
    if (pane) return pane;
    pane = document.createElement("div");
    pane.id = "incubics-files-pane";
    pane.innerHTML = '<div class="incubics-files-bar"><div><h2>Files</h2><p>Stored on the Launchpad server. Each file can be up to 100 MB.</p></div>' +
      '<label class="incubics-files-upload">Upload<input type="file" multiple></label></div>' +
      '<p class="incubics-files-note" hidden></p><div class="incubics-files-list"></div>';
    pane.addEventListener("click", function (event) {
      event.stopPropagation();
      var row = event.target.closest("[data-file]");
      if (!row) return;
      openFile(listed[row.getAttribute("data-file")]);
    });
    pane.querySelector("input").addEventListener("change", function (event) {
      var input = event.currentTarget;
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      input.value = "";
      if (files.length) uploadFiles(files);
    });
    document.body.appendChild(pane);
    return pane;
  }

  function hide() {
    document.body.classList.remove("incubics-files-on");
    var pane = document.getElementById("incubics-files-pane");
    if (pane) pane.remove();
    loadedKey = "";
    current = null;
  }

  function canPreview(file) {
    var type = file && file.mime_type || "";
    var name = file && file.name || "";
    return /^(image\/|text\/|application\/pdf)/.test(type) || /\.(png|jpe?g|gif|webp|txt|pdf|csv|json|md)$/i.test(name);
  }

  function render(files) {
    var list = document.querySelector("#incubics-files-pane .incubics-files-list");
    if (!list) return;
    listed = {};
    if (!files.length) {
      list.innerHTML = '<p class="incubics-files-empty">No files in this channel yet.</p>';
      return;
    }
    list.innerHTML = files.map(function (file) {
      listed[file.id] = file;
      var image = /^image\//.test(file.mime_type || "");
      var thumb = image ? '<img src="/api/v4/files/' + encodeURIComponent(file.id) + '/thumbnail" alt="">' : '<span class="incubics-files-ext">' + escapeHtml((file.extension || "file").slice(0, 4)) + "</span>";
      return '<button type="button" class="incubics-files-row" data-file="' + escapeHtml(file.id) + '">' +
        thumb +
        '<span class="incubics-files-name">' + escapeHtml(file.name || "File") + "</span>" +
        '<span class="incubics-files-meta">' + escapeHtml(formatSize(file.size)) + " · " + escapeHtml(formatWhen(file.create_at)) + "</span></button>";
    }).join("");
  }

  function openFile(file) {
    if (!file || !file.id) return;
    var preview = canPreview(file) ? window.open("", "_blank") : null;
    setNote("Opening " + (file.name || "file") + "…");
    fetch("/api/v4/files/" + encodeURIComponent(file.id), {
      method: "GET",
      credentials: "same-origin",
      headers: fileHeaders()
    }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      var headerType = (response.headers.get("Content-Type") || file.mime_type || "application/octet-stream").split(";")[0];
      return response.blob().then(function (blob) {
        return blob.type === headerType ? blob : new Blob([blob], {type: headerType});
      });
    }).then(function (blob) {
      var type = blob.type || "";
      if (preview && !preview.closed && type.indexOf("text/") === 0) {
        return blob.text().then(function (text) {
          var body = preview.document.body;
          body.textContent = "";
          var pre = preview.document.createElement("pre");
          pre.style.whiteSpace = "pre-wrap";
          pre.style.fontFamily = "inherit";
          pre.textContent = text;
          body.appendChild(pre);
          preview.document.title = file.name || "File";
          setNote("");
        });
      }
      var url = URL.createObjectURL(blob);
      if (preview && !preview.closed && type.indexOf("image/") === 0) {
        var image = preview.document.createElement("img");
        image.alt = file.name || "";
        image.src = url;
        preview.document.body.textContent = "";
        preview.document.body.appendChild(image);
      } else if (preview && !preview.closed && type === "application/pdf") {
        preview.location.href = url;
      } else {
        if (preview && !preview.closed) preview.close();
        var link = document.createElement("a");
        link.href = url;
        link.download = file.name || "download";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setNote("");
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }).catch(function () {
      if (preview && !preview.closed) preview.close();
      setNote("The file could not be opened.");
    });
  }

  function fromPosts(channelId) {
    var files = [];
    var seen = {};
    function add(info) {
      if (!info || !info.id || seen[info.id]) return;
      seen[info.id] = true;
      files.push(info);
    }
    function page(index) {
      return api("/api/v4/channels/" + channelId + "/posts?per_page=100&page=" + index).then(function (data) {
        var posts = (data && data.posts) || {};
        var order = (data && data.order) || [];
        var pending = [];
        order.forEach(function (id) {
          var post = posts[id];
          if (!post) return;
          var infos = post.metadata && post.metadata.files;
          if (infos && infos.length) {
            infos.forEach(add);
            return;
          }
          (post.file_ids || []).forEach(function (fileId) {
            pending.push(api("/api/v4/files/" + fileId + "/info").then(add).catch(function () {}));
          });
        });
        return Promise.all(pending).then(function () {
          if (order.length < 100 || index >= 4) return files;
          return page(index + 1);
        });
      });
    }
    return page(0);
  }

  function load(route) {
    var key = route.team + "/" + route.channel;
    if (loadedKey === key && current) return;
    loadedKey = key;
    var gen = ++loadGen;
    setNote("Loading files…");
    api("/api/v4/teams/name/" + encodeURIComponent(route.team)).then(function (team) {
      return api("/api/v4/teams/" + team.id + "/channels/name/" + encodeURIComponent(route.channel)).then(function (channel) {
        current = {key: key, team: team, channel: channel};
        return fromPosts(channel.id);
      });
    }).then(function (files) {
      if (gen !== loadGen || !current || current.key !== key) return;
      files.sort(function (a, b) { return (b.create_at || 0) - (a.create_at || 0); });
      render(files);
      setNote("");
    }).catch(function () {
      if (loadedKey !== key) return;
      setNote("Files could not be loaded.");
    });
  }

  function uploadFiles(files) {
    if (!current) return;
    setNote("Uploading…");
    var channelId = current.channel.id;
    var body = new FormData();
    body.append("channel_id", channelId);
    files.forEach(function (file) { body.append("files", file, file.name); });
    var headers = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"};
    var token = csrf();
    if (token) headers["X-CSRF-Token"] = token;
    fetch("/api/v4/files", {method: "POST", credentials: "same-origin", headers: headers, body: body}).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    }).then(function (payload) {
      var ids = (payload.file_infos || []).map(function (info) { return info.id; });
      if (!ids.length) throw new Error("empty");
      var names = (payload.file_infos || []).map(function (info) { return info.name; }).join(", ");
      return api("/api/v4/posts", {method: "POST", body: {channel_id: channelId, message: "Shared " + names, file_ids: ids}});
    }).then(function () {
      loadedKey = "";
      load(channelRoute());
    }).catch(function () {
      setNote("The file could not be uploaded.");
    });
  }

  function paint() {
    ensureTab();
    var route = channelRoute();
    if (!route || !filesActive()) {
      if (document.body.classList.contains("incubics-files-on")) hide();
      return;
    }
    var pane = ensurePane();
    document.body.classList.add("incubics-files-on");
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
    var pane = document.getElementById("incubics-files-pane");
    if (pane && document.body.classList.contains("incubics-files-on")) place(pane);
  });
  var observer = new MutationObserver(queue);
  function start() {
    queue();
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
