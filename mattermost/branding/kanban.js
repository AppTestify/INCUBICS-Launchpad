(function () {
  if (window.top !== window.self) return;
  if (window.__incubicsKanban) return;
  window.__incubicsKanban = true;

  var mode = "messages";
  var state = null;
  var loadingKey = "";

  var COLORS = {
    propColorGray: "#8b95a5",
    propColorBrown: "#a37b67",
    propColorOrange: "#e07a3d",
    propColorYellow: "#d9a014",
    propColorGreen: "#1f9d68",
    propColorBlue: "#3d7ee8",
    propColorPurple: "#7a5af0",
    propColorPink: "#d4537e",
    propColorRed: "#d64545"
  };

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

  function uid() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    for (var i = 0; i < 27; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
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

  function propertyById(board, id) {
    var props = (board && board.cardProperties) || [];
    for (var i = 0; i < props.length; i++) if (props[i].id === id) return props[i];
    return null;
  }

  function optionById(property, id) {
    var options = (property && property.options) || [];
    for (var i = 0; i < options.length; i++) if (options[i].id === id) return options[i];
    return null;
  }

  function boardFor(route) {
    var teamPromise = api("/api/v4/teams/name/" + encodeURIComponent(route.team));
    return teamPromise.then(function (team) {
      return api("/api/v4/teams/" + team.id + "/channels/name/" + encodeURIComponent(route.channel)).then(function (channel) {
        return api("/plugins/focalboard/api/v2/teams/" + team.id + "/boards").then(function (boards) {
          var linked = (boards || []).filter(function (item) {
            return item && item.channelId === channel.id && !item.isTemplate;
          });
          if (!linked.length) return null;
          var board = linked[0];
          return api("/plugins/focalboard/api/v2/boards/" + board.id + "/blocks").then(function (blocks) {
            blocks = Array.isArray(blocks) ? blocks : [];
            var views = blocks.filter(function (block) { return block.type === "view" && block.fields && block.fields.viewType === "board"; });
            var status = ((board.cardProperties) || []).filter(function (item) { return item.type === "select" && /status/i.test(item.name || ""); })[0];
            var view = views.filter(function (item) { return status && item.fields.groupById === status.id; })[0] || views[0] || null;
            var groupById = view && view.fields ? view.fields.groupById : (status && status.id);
            return {
              key: route.team + "/" + route.channel,
              team: team,
              channel: channel,
              board: board,
              view: view,
              groupById: groupById,
              blocks: blocks
            };
          });
        });
      });
    });
  }

  function cardsOf(data) {
    var order = (data.view && data.view.fields && data.view.fields.cardOrder) || [];
    var rank = {};
    order.forEach(function (id, index) { rank[id] = index; });
    return data.blocks.filter(function (block) {
      return block.type === "card" && !block.deleteAt && block.boardId === data.board.id;
    }).sort(function (a, b) {
      var ar = rank[a.id] == null ? 100000 : rank[a.id];
      var br = rank[b.id] == null ? 100000 : rank[b.id];
      return ar - br;
    });
  }

  function columnsOf(data) {
    var property = propertyById(data.board, data.groupById);
    var options = (property && property.options) || [];
    var visible = data.view && data.view.fields && data.view.fields.visibleOptionIds;
    var hidden = {};
    ((data.view && data.view.fields && data.view.fields.hiddenOptionIds) || []).forEach(function (id) { hidden[id] = true; });
    var columns = [];
    var seen = {};
    function add(id) {
      if (!id || seen[id] || hidden[id]) return;
      seen[id] = true;
      var option = optionById(property, id);
      if (!option) return;
      columns.push({id: option.id, name: option.value, color: COLORS[option.color] || "#8b95a5"});
    }
    (visible && visible.length ? visible : options.map(function (option) { return option.id; })).forEach(add);
    if (!columns.length) options.forEach(function (option) { add(option.id); });
    return columns;
  }

  function cardValue(card, propertyId) {
    var props = card.fields && card.fields.properties;
    return props && props[propertyId] ? props[propertyId] : "";
  }

  function badge(data, card) {
    var ids = (data.view && data.view.fields && data.view.fields.visiblePropertyIds) || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === data.groupById) continue;
      var property = propertyById(data.board, ids[i]);
      if (!property || property.type !== "select") continue;
      var option = optionById(property, cardValue(card, property.id));
      if (!option) continue;
      return {name: option.value, color: COLORS[option.color] || "#8b95a5"};
    }
    return null;
  }

  function ensurePane() {
    var pane = document.getElementById("incubics-kanban-pane");
    if (pane) return pane;
    pane = document.createElement("div");
    pane.id = "incubics-kanban-pane";
    pane.innerHTML = '<div class="incubics-kanban-status">Opening kanban…</div><div class="incubics-kanban-board"></div>';
    pane.addEventListener("click", function (event) { event.stopPropagation(); });
    pane.addEventListener("dragover", function (event) {
      var column = event.target.closest(".incubics-kanban-cards");
      if (!column) return;
      event.preventDefault();
      column.classList.add("is-over");
    });
    pane.addEventListener("dragleave", function (event) {
      var column = event.target.closest(".incubics-kanban-cards");
      if (column) column.classList.remove("is-over");
    });
    pane.addEventListener("drop", function (event) {
      var column = event.target.closest(".incubics-kanban-cards");
      if (!column || !state) return;
      event.preventDefault();
      column.classList.remove("is-over");
      var cardId = event.dataTransfer.getData("text/plain");
      moveCard(cardId, column.getAttribute("data-option") || "");
    });
    pane.addEventListener("click", function (event) {
      var add = event.target.closest(".incubics-kanban-add");
      if (!add) return;
      var column = add.closest(".incubics-kanban-column");
      var existing = column.querySelector(".incubics-kanban-compose");
      if (existing) { existing.querySelector("input").focus(); return; }
      var form = document.createElement("form");
      form.className = "incubics-kanban-compose";
      form.innerHTML = '<input type="text" maxlength="200" placeholder="Card title" aria-label="Card title"><div><button type="submit">Add</button><button type="button" data-cancel>Cancel</button></div>';
      add.insertAdjacentElement("beforebegin", form);
      var input = form.querySelector("input");
      input.focus();
      form.addEventListener("click", function (click) {
        if (click.target.hasAttribute("data-cancel")) form.remove();
      });
      form.addEventListener("submit", function (submit) {
        submit.preventDefault();
        var title = input.value.trim();
        if (!title) return;
        createCard(title, column.getAttribute("data-option") || "");
      });
    });
    document.body.appendChild(pane);
    return pane;
  }

  function setStatus(text) {
    var pane = document.getElementById("incubics-kanban-pane");
    if (!pane) return;
    var status = pane.querySelector(".incubics-kanban-status");
    status.hidden = !text;
    status.textContent = text || "";
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

  function render(data) {
    var pane = ensurePane();
    var board = pane.querySelector(".incubics-kanban-board");
    var cards = cardsOf(data);
    var columns = columnsOf(data);
    var html = columns.map(function (column) {
      var mine = cards.filter(function (card) { return cardValue(card, data.groupById) === column.id; });
      var cardHtml = mine.map(function (card) {
        var label = badge(data, card);
        var icon = card.fields && card.fields.icon ? '<span class="incubics-kanban-icon">' + escapeHtml(card.fields.icon) + "</span>" : "";
        var pill = label ? '<span class="incubics-kanban-pill" style="--pill:' + label.color + '">' + escapeHtml(label.name) + "</span>" : "";
        return '<article class="incubics-kanban-card" draggable="true" data-card="' + escapeHtml(card.id) + '">' + icon + '<span>' + escapeHtml(card.title || "Untitled") + "</span>" + pill + "</article>";
      }).join("");
      if (!cardHtml) cardHtml = '<div class="incubics-kanban-empty">No cards</div>';
      return '<section class="incubics-kanban-column" data-option="' + escapeHtml(column.id) + '">' +
        '<header><i style="background:' + column.color + '"></i><strong>' + escapeHtml(column.name) + '</strong><em>' + mine.length + "</em></header>" +
        '<div class="incubics-kanban-cards" data-option="' + escapeHtml(column.id) + '">' + cardHtml + "</div>" +
        '<button type="button" class="incubics-kanban-add">Add a card</button></section>';
    }).join("");
    board.innerHTML = html || '<div class="incubics-kanban-empty">This board has no columns yet.</div>';
    var nodes = board.querySelectorAll(".incubics-kanban-card");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener("dragstart", function (event) {
        event.dataTransfer.setData("text/plain", event.currentTarget.getAttribute("data-card"));
        event.dataTransfer.effectAllowed = "move";
      });
    }
    setStatus("");
    pane.dataset.ready = "1";
  }

  function moveCard(cardId, optionId) {
    if (!state) return;
    var card = null;
    state.blocks.forEach(function (block) { if (block.id === cardId) card = block; });
    if (!card || cardValue(card, state.groupById) === optionId) return;
    var properties = Object.assign({}, (card.fields && card.fields.properties) || {});
    if (optionId) properties[state.groupById] = optionId;
    else delete properties[state.groupById];
    var previous = card.fields.properties;
    card.fields.properties = properties;
    render(state);
    api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks/" + card.id, {
      method: "PATCH",
      body: {updatedFields: {properties: properties}, deletedFields: []}
    }).catch(function () {
      card.fields.properties = previous;
      render(state);
      setStatus("The card could not be moved.");
    });
  }

  function createCard(title, optionId) {
    if (!state) return;
    var properties = {};
    if (optionId && state.groupById) properties[state.groupById] = optionId;
    var now = Date.now();
    var block = {
      id: "c" + uid().slice(1),
      schema: 1,
      boardId: state.board.id,
      parentId: state.board.id,
      type: "card",
      title: title,
      createAt: now,
      updateAt: now,
      fields: {properties: properties, contentOrder: [], icon: ""}
    };
    api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks", {
      method: "POST",
      body: [block]
    }).then(function (created) {
      var saved = Array.isArray(created) && created[0] ? created[0] : block;
      if (!saved.fields) saved.fields = block.fields;
      state.blocks.push(saved);
      render(state);
    }).catch(function () {
      setStatus("The card could not be added.");
    });
  }

  function hideKanban() {
    document.body.classList.remove("incubics-kanban-on");
    var pane = document.getElementById("incubics-kanban-pane");
    if (pane) pane.remove();
    state = null;
    loadingKey = "";
  }

  function showKanban(route) {
    var pane = ensurePane();
    document.body.classList.add("incubics-kanban-on");
    place(pane);
    var key = route.team + "/" + route.channel;
    if (state && state.key === key && pane.dataset.ready === "1") return;
    if (loadingKey === key) return;
    loadingKey = key;
    pane.dataset.ready = "";
    setStatus("Opening kanban…");
    boardFor(route).then(function (data) {
      if (loadingKey !== key || mode !== "kanban") return;
      if (!data) {
        setStatus("This channel does not have a kanban yet.");
        pane.querySelector(".incubics-kanban-board").innerHTML = "";
        return;
      }
      state = data;
      render(data);
    }).catch(function () {
      if (loadingKey !== key) return;
      setStatus("The kanban could not be opened.");
    });
  }

  function setActive(bar) {
    var buttons = bar.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-active", buttons[i].getAttribute("data-tab") === mode);
    }
  }

  function paint() {
    var route = channelRoute();
    var bar = document.getElementById("incubics-channel-tabs");
    if (!route) {
      if (bar) bar.remove();
      hideKanban();
      return;
    }
    var channelHeader = header();
    if (!channelHeader) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "incubics-channel-tabs";
      bar.innerHTML = '<button type="button" data-tab="messages">Messages</button><button type="button" data-tab="kanban">Kanban</button>';
      bar.addEventListener("click", function (event) {
        var button = event.target.closest("button");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        mode = button.getAttribute("data-tab");
        loadingKey = "";
        if (state) state.key = "";
        var pane = document.getElementById("incubics-kanban-pane");
        if (pane) pane.dataset.ready = "";
        paint();
      });
    }
    if (bar.previousElementSibling !== channelHeader) channelHeader.insertAdjacentElement("afterend", bar);
    setActive(bar);
    if (mode === "kanban") showKanban(route);
    else hideKanban();
  }

  var pushState = history.pushState;
  history.pushState = function () {
    pushState.apply(history, arguments);
    paint();
  };
  var replaceState = history.replaceState;
  history.replaceState = function () {
    replaceState.apply(history, arguments);
    paint();
  };
  window.addEventListener("popstate", paint);
  window.addEventListener("resize", function () {
    var pane = document.getElementById("incubics-kanban-pane");
    if (pane && document.body.classList.contains("incubics-kanban-on")) place(pane);
  });
  var queued = false;
  var observer = new MutationObserver(function () {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      paint();
    }, 60);
  });
  function start() {
    paint();
    observer.observe(document.body, {childList: true, subtree: true});
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
