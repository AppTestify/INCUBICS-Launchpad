(function () {
  var LINKS = [
    {
      name: "Windows",
      href: "https://releases.mattermost.com/desktop/6.3.2/mattermost-desktop-6.3.2-win-x64.msi",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 4.4h8.3v7.1H3V4.4zm9.4 0H21v7.1h-8.6V4.4zM3 12.5h8.3V20H3v-7.5zm9.4 0H21V20h-8.6v-7.5z"/></svg>'
    },
    {
      name: "macOS",
      href: "https://releases.mattermost.com/desktop/6.3.2/mattermost-desktop-6.3.2-mac-universal.dmg",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5h10a2 2 0 0 1 2 2V16H5V6.5a2 2 0 0 1 2-2zm-2.2 13h14.4a1.2 1.2 0 0 1 0 2.4H4.8a1.2 1.2 0 0 1 0-2.4z"/></svg>'
    },
    {
      name: "Android",
      href: "https://play.google.com/store/apps/details?id=com.mattermost.rn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.2 8.2h9.6v8.2a2 2 0 0 1-2 2h-1.1v2.1h-1.6v-2.1H11v2.1H9.4v-2.1H8.2a2 2 0 0 1-2-2V8.2zm2.1-2.3 1 .9h3.4l1-.9.9 1.1-1.2 1H8.6L7.4 7zM8.2 6.4a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6zm7.6 0a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z"/></svg>'
    },
    {
      name: "iOS",
      href: "https://apps.apple.com/us/app/mattermost/id1257222717",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 2.8h8a2 2 0 0 1 2 2v14.4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2zm4 16.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM8.2 4.6h7.6v12.2H8.2V4.6z"/></svg>'
    }
  ];

  function onDownloadScreen() {
    var path = window.location.pathname || "/";
    return path === "/" ||
      path.indexOf("/landing") === 0 ||
      path.indexOf("/login") === 0 ||
      path.indexOf("/signup") === 0 ||
      path.indexOf("/reset") === 0 ||
      path.indexOf("/claim") === 0 ||
      path.indexOf("/access_problem") === 0;
  }

  function render() {
    var footer = document.getElementById("incubics-app-footer");
    var show = onDownloadScreen();
    document.body.classList.toggle("incubics-app-footer-on", show);
    if (!show) {
      if (footer) footer.remove();
      return;
    }
    if (footer) return;

    footer = document.createElement("footer");
    footer.id = "incubics-app-footer";
    footer.setAttribute("aria-label", "Download the app");

    LINKS.forEach(function (item) {
      var link = document.createElement("a");
      link.href = item.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", "Download for " + item.name);
      link.innerHTML = item.icon + "<span>" + item.name + "</span>";
      footer.appendChild(link);
    });

    document.body.appendChild(footer);
  }

  var pushState = history.pushState;
  history.pushState = function () {
    pushState.apply(history, arguments);
    render();
  };
  var replaceState = history.replaceState;
  history.replaceState = function () {
    replaceState.apply(history, arguments);
    render();
  };
  window.addEventListener("popstate", render);
  window.addEventListener("hashchange", render);
  if (document.body) {
    render();
  } else {
    document.addEventListener("DOMContentLoaded", render);
  }
})();
