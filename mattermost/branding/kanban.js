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
  if (window.__incubicsKanban) return;
  window.__incubicsKanban = true;

  var mode = "messages";
  var state = null;
  var loadingKey = "";
  var loadingPromise = null;

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

  function findProp(board, type, nameRe) {
    var props = (board && board.cardProperties) || [];
    var match = null;
    for (var i = 0; i < props.length; i++) {
      if (props[i].type !== type) continue;
      if (nameRe && nameRe.test(props[i].name || "")) return props[i];
      if (!match) match = props[i];
    }
    return nameRe ? null : match;
  }

  function optionById(property, id) {
    var options = (property && property.options) || [];
    for (var i = 0; i < options.length; i++) if (options[i].id === id) return options[i];
    return null;
  }

  function memberName(user) {
    if (!user) return "";
    var name = ((user.first_name || "") + " " + (user.last_name || "")).trim();
    return name || user.username || "Someone";
  }

  function formatDay(ms) {
    try {
      return new Intl.DateTimeFormat("en-IN", {day: "numeric", month: "short", timeZone: "Asia/Kolkata"}).format(new Date(ms));
    } catch (err) {
      return "";
    }
  }

  function dateInputValue(ms) {
    try {
      return new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date(ms));
    } catch (err) {
      return "";
    }
  }

  function dateInputToMs(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    var ms = Date.parse(match[1] + "-" + match[2] + "-" + match[3] + "T23:59:00+05:30");
    return isNaN(ms) ? null : ms;
  }

  function readDate(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return value;
    if (typeof value === "object" && value.from) return Number(value.from);
    if (typeof value === "string") {
      if (/^\d+$/.test(value)) return Number(value);
      try {
        var parsed = JSON.parse(value);
        if (parsed && parsed.from) return Number(parsed.from);
      } catch (err) {}
    }
    return null;
  }

  function boardFor(route) {
    return api("/api/v4/teams/name/" + encodeURIComponent(route.team)).then(function (team) {
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
            return api("/api/v4/users?in_channel=" + channel.id + "&per_page=200").then(function (members) {
              return {
                key: route.team + "/" + route.channel,
                team: team,
                channel: channel,
                board: board,
                view: view,
                groupById: groupById,
                blocks: blocks,
                members: members || []
              };
            });
          });
        });
      });
    });
  }

  function ensureData(route) {
    var key = route.team + "/" + route.channel;
    if (state && state.key === key) return Promise.resolve(state);
    if (loadingKey === key && loadingPromise) return loadingPromise;
    loadingKey = key;
    loadingPromise = boardFor(route).then(function (data) {
      if (loadingKey !== key) return state;
      state = data || {key: key, empty: true, members: [], blocks: []};
      return state;
    }).catch(function () {
      if (loadingKey === key) state = {key: key, empty: true, error: true, members: [], blocks: []};
      return state;
    });
    return loadingPromise;
  }

  function cardsOf(data) {
    var order = (data.view && data.view.fields && data.view.fields.cardOrder) || [];
    var rank = {};
    order.forEach(function (id, index) { rank[id] = index; });
    return (data.blocks || []).filter(function (block) {
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
    if (!props || props[propertyId] == null || props[propertyId] === "") return "";
    return props[propertyId];
  }

  function personProp(data) {
    return findProp(data.board, "person", /assign/i) || findProp(data.board, "person");
  }

  function dateProp(data) {
    return findProp(data.board, "date", /due|deadline/i) || findProp(data.board, "date");
  }

  function cardAssignee(card) {
    if (!state || state.empty) return "";
    var prop = personProp(state);
    var userId = prop ? cardValue(card, prop.id) : (card.fields && card.fields.assigneeId);
    if (Array.isArray(userId)) userId = userId[0];
    return userId || "";
  }

  function cardDeadline(card) {
    if (!state || state.empty) return null;
    var prop = dateProp(state);
    return readDate(prop ? cardValue(card, prop.id) : (card.fields && card.fields.deadline));
  }

  function memberById(id) {
    var members = (state && state.members) || [];
    for (var i = 0; i < members.length; i++) if (members[i].id === id) return members[i];
    return null;
  }

  function cardForPost(postId) {
    if (!state || !state.blocks) return null;
    for (var i = 0; i < state.blocks.length; i++) {
      var block = state.blocks[i];
      if (block.type === "card" && !block.deleteAt && block.fields && block.fields.postId === postId) return block;
    }
    return null;
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

  function assignmentLabel(card) {
    var whoId = cardAssignee(card);
    var who = whoId ? memberName(memberById(whoId)) : "";
    var due = cardDeadline(card);
    if (!who && !due) return "";
    var text = who ? "Assigned to " + who : "Assigned";
    if (due) text += " · Due " + formatDay(due);
    return text;
  }

  function closeAssign() {
    var dialog = document.getElementById("incubics-assign-dialog");
    if (dialog) dialog.remove();
  }

  function closeCard() {
    var dialog = document.getElementById("incubics-card-dialog");
    if (dialog) dialog.remove();
    var pane = document.getElementById("incubics-kanban-pane");
    if (pane) pane.dataset.ticket = "";
  }

  function findBlock(id) {
    var found = null;
    (state.blocks || []).forEach(function (block) { if (block.id === id) found = block; });
    return found;
  }

  function textBlockFor(card) {
    var found = null;
    (state.blocks || []).forEach(function (block) {
      if (!found && block && !block.deleteAt && block.parentId === card.id && block.type === "text") found = block;
    });
    return found;
  }

  function cardText(card) {
    var parts = [];
    (state.blocks || []).forEach(function (block) {
      if (!block || block.deleteAt || block.parentId !== card.id) return;
      if (block.type !== "text" && block.type !== "comment") return;
      var content = block.fields && block.fields.content;
      if (content) parts.push(String(content));
    });
    return parts.join("\n\n").trim();
  }

  function ticketProperties(card, optionId, assignee, deadline) {
    var properties = Object.assign({}, card && card.fields ? card.fields.properties : {});
    if (state.groupById) {
      if (optionId) properties[state.groupById] = optionId;
      else delete properties[state.groupById];
    }
    var person = personProp(state);
    var due = dateProp(state);
    if (person) {
      if (assignee) properties[person.id] = assignee;
      else delete properties[person.id];
    }
    if (due) {
      if (deadline) properties[due.id] = JSON.stringify({from: deadline});
      else delete properties[due.id];
    }
    return properties;
  }

  function writeDetails(card, details) {
    var existing = textBlockFor(card);
    if (!details && !existing) return Promise.resolve(card);
    if (existing) {
      existing.fields = Object.assign({}, existing.fields, {content: details});
      return api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks/" + existing.id, {
        method: "PATCH",
        body: {updatedFields: {fields: existing.fields, content: details}, deletedFields: []}
      }).then(function () { return card; });
    }
    var now = Date.now();
    var text = {
      id: "t" + uid().slice(1),
      schema: 1,
      boardId: state.board.id,
      parentId: card.id,
      type: "text",
      title: "",
      createAt: now,
      updateAt: now,
      fields: {content: details}
    };
    return api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks", {
      method: "POST",
      body: [text]
    }).then(function (created) {
      var saved = Array.isArray(created) && created[0] ? created[0] : text;
      if (!saved.fields) saved.fields = text.fields;
      state.blocks.push(saved);
      var order = [[saved.id]];
      card.fields = Object.assign({}, card.fields, {contentOrder: order});
      return api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks/" + card.id, {
        method: "PATCH",
        body: {updatedFields: {fields: card.fields, contentOrder: order}, deletedFields: []}
      }).then(function () { return card; });
    });
  }

  function rememberCard(card, title, properties, assignee, deadline) {
    card.title = title;
    card.fields = Object.assign({}, card.fields, {
      properties: properties,
      assigneeId: assignee,
      deadline: deadline || 0
    });
    return card;
  }

  function patchCard(card, title, properties, assignee, deadline) {
    rememberCard(card, title, properties, assignee, deadline);
    return api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks/" + card.id, {
      method: "PATCH",
      body: {
        updatedFields: {
          title: title,
          fields: card.fields,
          properties: properties,
          postId: card.fields.postId || "",
          assigneeId: assignee,
          deadline: deadline || 0
        },
        deletedFields: []
      }
    });
  }

  function openInChat(postId) {
    closeCard();
    mode = "messages";
    hideKanban();
    var bar = document.getElementById("incubics-channel-tabs");
    if (bar) setActive(bar);
    var post = document.getElementById("post_" + postId);
    if (post) {
      post.scrollIntoView({block: "center"});
      return;
    }
    var route = channelRoute();
    if (route) history.pushState({}, "", "/" + encodeURIComponent(route.team) + "/pl/" + postId);
  }

  function openTicket(card, optionId) {
    if (!state || state.empty) return;
    closeAssign();
    var pane = ensurePane();
    var board = pane.querySelector(".incubics-kanban-board");
    var columns = columnsOf(state);
    var statusOptions = columns.map(function (column) {
      return '<option value="' + escapeHtml(column.id) + '">' + escapeHtml(column.name) + "</option>";
    }).join("");
    var people = (state.members || []).slice().sort(function (a, b) {
      return memberName(a).localeCompare(memberName(b));
    });
    var personOptions = '<option value="">Unassigned</option>' + people.map(function (user) {
      return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(memberName(user)) + "</option>";
    }).join("");
    var postId = card && card.fields && card.fields.postId;
    board.classList.add("is-ticket");
    board.innerHTML = '<form class="incubics-ticket-page">' +
      '<button type="button" data-back>Back to board</button>' +
      "<h2>" + (card ? "Ticket" : "New ticket") + "</h2>" +
      '<label>Title<input name="title" maxlength="200" required></label>' +
      '<label>Status<select name="status">' + statusOptions + "</select></label>" +
      '<label>Assign to<select name="assignee">' + personOptions + "</select></label>" +
      '<label>Deadline<input name="deadline" type="date"></label>' +
      '<label>Details<textarea name="details" rows="8" maxlength="4000" placeholder="Add the ticket details"></textarea></label>' +
      '<div class="incubics-ticket-actions"><button type="submit">Save ticket</button>' +
      (postId ? '<button type="button" data-chat>Open in chat</button>' : "") +
      '</div><p class="incubics-ticket-note" hidden></p></form>';
    var form = board.querySelector("form");
    var currentStatus = card ? cardValue(card, state.groupById) : (optionId || (columns[0] && columns[0].id) || "");
    form.elements.title.value = card ? (card.title || "") : "";
    if (currentStatus) form.elements.status.value = currentStatus;
    form.elements.assignee.value = card ? (cardAssignee(card) || "") : "";
    var due = card ? cardDeadline(card) : null;
    if (due) form.elements.deadline.value = dateInputValue(due);
    form.elements.details.value = card ? cardText(card) : "";
    form.querySelector("[data-back]").addEventListener("click", function () { render(state); });
    var chat = form.querySelector("[data-chat]");
    if (chat) chat.addEventListener("click", function () { openInChat(postId); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      saveTicket(form, card);
    });
    pane.dataset.ticket = "1";
    form.elements.title.focus();
  }

  function saveTicket(form, card) {
    var title = String(form.elements.title.value || "").trim();
    if (!title) return;
    var note = form.querySelector(".incubics-ticket-note");
    var submit = form.querySelector("[type='submit']");
    note.hidden = false;
    note.textContent = "Saving…";
    submit.disabled = true;
    var optionId = form.elements.status.value;
    var assignee = form.elements.assignee.value;
    var deadline = dateInputToMs(form.elements.deadline.value);
    var details = String(form.elements.details.value || "").trim();
    var properties = ticketProperties(card, optionId, assignee, deadline);
    var pending = card
      ? patchCard(card, title, properties, assignee, deadline).then(function () { return card; })
      : createTicket(title, properties, assignee, deadline);
    pending.then(function (saved) {
      return writeDetails(saved, details).then(function () { return saved; });
    }).then(function () {
      render(state);
    }).catch(function () {
      submit.disabled = false;
      note.textContent = "The ticket could not be saved.";
    });
  }

  function createTicket(title, properties, assignee, deadline) {
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
      fields: {properties: properties, contentOrder: [], icon: "", assigneeId: assignee, deadline: deadline || 0}
    };
    return api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks", {
      method: "POST",
      body: [block]
    }).then(function (created) {
      var saved = Array.isArray(created) && created[0] ? created[0] : block;
      if (!saved.fields) saved.fields = block.fields;
      saved.title = saved.title || title;
      state.blocks.push(saved);
      return saved;
    });
  }

  function openAssign(options) {
    if (!state || state.empty) return;
    closeAssign();
    var card = options.card || null;
    var dialog = document.createElement("div");
    dialog.id = "incubics-assign-dialog";
    var members = (state.members || []).slice().sort(function (a, b) {
      return memberName(a).localeCompare(memberName(b));
    });
    var optionsHtml = '<option value="">Choose a person</option>' + members.map(function (user) {
      return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(memberName(user)) + "</option>";
    }).join("");
    var currentWho = card ? cardAssignee(card) : "";
    var currentDue = card ? cardDeadline(card) : null;
    dialog.innerHTML = '<form class="incubics-assign-form" role="dialog" aria-label="Assign chat">' +
      "<h2>Assign this chat</h2>" +
      "<label>Assign to<select name=\"assignee\">" + optionsHtml + "</select></label>" +
      "<label>Deadline<input name=\"deadline\" type=\"date\" required></label>" +
      "<div><button type=\"submit\">Save</button><button type=\"button\" data-cancel>Cancel</button></div>" +
      "</form>";
    document.body.appendChild(dialog);
    var form = dialog.querySelector("form");
    form.elements.assignee.value = currentWho;
    if (currentDue) form.elements.deadline.value = dateInputValue(currentDue);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var assignee = form.elements.assignee.value;
      var deadline = dateInputToMs(form.elements.deadline.value);
      if (!assignee || !deadline) return;
      saveAssignment({
        card: card,
        postId: options.postId || (card && card.fields && card.fields.postId) || "",
        title: options.title || (card && card.title) || "Assigned chat",
        assignee: assignee,
        deadline: deadline
      });
      closeAssign();
    });
    form.querySelector("[data-cancel]").addEventListener("click", closeAssign);
    form.elements.assignee.focus();
  }

  function propertiesFor(assignee, deadline, optionId, previous) {
    var properties = Object.assign({}, previous || {});
    if (optionId && state.groupById && !properties[state.groupById]) properties[state.groupById] = optionId;
    var person = personProp(state);
    var due = dateProp(state);
    if (person) properties[person.id] = assignee;
    if (due) properties[due.id] = JSON.stringify({from: deadline});
    return properties;
  }

  function saveAssignment(input) {
    if (!state || state.empty) return;
    var firstColumn = columnsOf(state)[0];
    var optionId = input.optionId || (firstColumn ? firstColumn.id : "");
    if (input.card) {
      var card = input.card;
      var previous = card.fields.properties;
      var properties = propertiesFor(input.assignee, input.deadline, cardValue(card, state.groupById), previous);
      card.fields.properties = properties;
      card.fields.postId = input.postId || card.fields.postId || "";
      card.fields.assigneeId = input.assignee;
      card.fields.deadline = input.deadline;
      refreshViews();
      api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks/" + card.id, {
        method: "PATCH",
        body: {updatedFields: {properties: properties, postId: card.fields.postId, assigneeId: input.assignee, deadline: input.deadline}, deletedFields: []}
      }).catch(function () {
        card.fields.properties = previous;
        refreshViews();
      });
      return;
    }
    var now = Date.now();
    var properties = propertiesFor(input.assignee, input.deadline, optionId, {});
    var block = {
      id: "c" + uid().slice(1),
      schema: 1,
      boardId: state.board.id,
      parentId: state.board.id,
      type: "card",
      title: input.title,
      createAt: now,
      updateAt: now,
      fields: {properties: properties, contentOrder: [], icon: "", postId: input.postId, assigneeId: input.assignee, deadline: input.deadline}
    };
    api("/plugins/focalboard/api/v2/boards/" + state.board.id + "/blocks", {
      method: "POST",
      body: [block]
    }).then(function (created) {
      var saved = Array.isArray(created) && created[0] ? created[0] : block;
      if (!saved.fields) saved.fields = block.fields;
      if (!saved.fields.postId) saved.fields.postId = input.postId;
      state.blocks.push(saved);
      refreshViews();
    }).catch(function () {
      setStatus("The chat could not be assigned.");
    });
  }

  function postText(post) {
    var parts = [];
    var message = post.querySelector(".post-message__text");
    if (message && message.innerText.trim()) parts.push(message.innerText);
    var names = post.querySelectorAll(".file-preview__name, .file-view__name, [class*='fileName'], [class*='file-name']");
    for (var i = 0; i < names.length; i++) if (names[i].textContent.trim()) parts.push(names[i].textContent);
    var text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!text) {
      text = (post.innerText || "").replace(/\s+/g, " ");
      text = text.replace(/^.*?\d{1,2}:\d{2}\s*(AM|PM)\s*/i, "");
      text = text.replace(/^Assign\s+/i, "");
      text = text.replace(/\s*Assign(ed to .*)?$/i, "");
      text = text.replace(/\s+(pptx|pdf|docx|xlsx|png|jpe?g|gif|zip)\s+[\d.]+\s*mb/gi, "");
    }
    return text.trim().slice(0, 180) || "Assigned chat";
  }

  function postIdOf(post) {
    var id = post.id || "";
    if (id.indexOf("post_") === 0) return id.slice(5);
    return post.getAttribute("data-post-id") || "";
  }

  function decoratePosts() {
    if (!state || state.empty) return;
    var posts = document.querySelectorAll("#channel_view .post, .channel-view .post");
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      if (post.className.indexOf("system") !== -1 || post.className.indexOf("post--bot") !== -1) continue;
      var postId = postIdOf(post);
      if (!postId) continue;
      var button = post.querySelector(".incubics-assign");
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "incubics-assign";
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          var host = event.currentTarget.closest(".post");
          var id = postIdOf(host);
          openAssign({postId: id, card: cardForPost(id), title: postText(host)});
        });
        var message = post.querySelector(".post-message");
        if (message) message.insertAdjacentElement("afterend", button);
        else post.appendChild(button);
      }
      var card = cardForPost(postId);
      var label = card ? assignmentLabel(card) : "";
      var due = card ? cardDeadline(card) : null;
      button.classList.toggle("is-set", !!label);
      button.classList.toggle("is-overdue", !!(due && due < Date.now()));
      button.textContent = label || "Assign";
    }
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
      var assign = event.target.closest(".incubics-kanban-assign");
      if (assign) {
        var cardId = assign.getAttribute("data-card");
        var found = null;
        (state.blocks || []).forEach(function (block) { if (block.id === cardId) found = block; });
        if (found) openAssign({card: found, postId: found.fields && found.fields.postId, title: found.title});
        return;
      }
      var cardEl = event.target.closest(".incubics-kanban-card");
      if (cardEl) {
        if (pane.dataset.dragging === "1") return;
        event.preventDefault();
        openTicket(findBlock(cardEl.getAttribute("data-card")));
        return;
      }
      var add = event.target.closest(".incubics-kanban-add");
      if (!add) return;
      var column = add.closest(".incubics-kanban-column");
      openTicket(null, column ? column.getAttribute("data-option") || "" : "");
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
    pane.dataset.ticket = "";
    var board = pane.querySelector(".incubics-kanban-board");
    board.classList.remove("is-ticket");
    var cards = cardsOf(data);
    var columns = columnsOf(data);
    var html = columns.map(function (column) {
      var mine = cards.filter(function (card) { return cardValue(card, data.groupById) === column.id; });
      var cardHtml = mine.map(function (card) {
        var label = badge(data, card);
        var icon = card.fields && card.fields.icon ? '<span class="incubics-kanban-icon">' + escapeHtml(card.fields.icon) + "</span>" : "";
        var pill = label ? '<span class="incubics-kanban-pill" style="--pill:' + label.color + '">' + escapeHtml(label.name) + "</span>" : "";
        var assigned = assignmentLabel(card);
        var due = cardDeadline(card);
        var meta = '<button type="button" class="incubics-kanban-assign' + (due && due < Date.now() ? " is-overdue" : "") + '" data-card="' + escapeHtml(card.id) + '">' + escapeHtml(assigned || "Assign") + "</button>";
        return '<article class="incubics-kanban-card" draggable="true" data-card="' + escapeHtml(card.id) + '">' + icon + '<span class="incubics-kanban-title">' + escapeHtml(card.title || "Untitled") + "</span>" + pill + meta + "</article>";
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
        if (event.target.closest(".incubics-kanban-assign")) {
          event.preventDefault();
          return;
        }
        pane.dataset.dragging = "1";
        event.dataTransfer.setData("text/plain", event.currentTarget.getAttribute("data-card"));
        event.dataTransfer.effectAllowed = "move";
      });
      nodes[i].addEventListener("dragend", function () {
        setTimeout(function () { pane.dataset.dragging = ""; }, 50);
      });
    }
    setStatus("");
    pane.dataset.ready = "1";
  }

  function refreshViews() {
    decoratePosts();
    if (mode === "kanban" && state && !state.empty) render(state);
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
    if (!state || state.empty) return;
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
    closeCard();
    document.body.classList.remove("incubics-kanban-on");
    var pane = document.getElementById("incubics-kanban-pane");
    if (pane) pane.remove();
  }

  function showKanban(route) {
    var pane = ensurePane();
    document.body.classList.add("incubics-kanban-on");
    place(pane);
    if (!state || state.key !== route.team + "/" + route.channel) {
      setStatus("Opening kanban…");
      return;
    }
    if (state.empty) {
      setStatus(state.error ? "The kanban could not be opened." : "This channel does not have a kanban yet.");
      pane.querySelector(".incubics-kanban-board").innerHTML = "";
      return;
    }
    if (pane.dataset.ticket === "1") {
      place(pane);
      return;
    }
    if (pane.dataset.ready === "1" && pane.dataset.key === state.key) {
      place(pane);
      return;
    }
    pane.dataset.key = state.key;
    render(state);
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
      closeAssign();
      hideKanban();
      state = null;
      loadingKey = "";
      loadingPromise = null;
      return;
    }
    var channelHeader = header();
    if (!channelHeader) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "incubics-channel-tabs";
      bar.innerHTML = '<button type="button" data-tab="messages">Messages</button><button type="button" data-tab="kanban">Kanban</button><button type="button" data-tab="meetings">Meetings</button><button type="button" data-tab="files">Files</button>';
      bar.addEventListener("click", function (event) {
        var button = event.target.closest("button");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        mode = button.getAttribute("data-tab");
        var pane = document.getElementById("incubics-kanban-pane");
        if (pane) pane.dataset.ready = "";
        paint();
      });
    }
    var anchor = document.getElementById("incubics-schedule-bar") || channelHeader;
    if (bar.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", bar);
    setActive(bar);
    ensureData(route).then(function () {
      var current = channelRoute();
      if (!current || !state || state.key !== current.team + "/" + current.channel) return;
      decoratePosts();
      if (mode === "kanban") showKanban(current);
      else hideKanban();
    });
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
