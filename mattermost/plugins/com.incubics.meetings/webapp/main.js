(function () {
  var version = "15";

  function loadStyle(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var script = document.createElement("script");
      script.src = src;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(script);
    });
  }

  window.registerPlugin("com.incubics.meetings", {
    initialize: function (registry) {
      var added = false;
      function addButton() {
        if (added || !window.IncubicsMeetings) return;
        added = true;
        registry.registerChannelHeaderButtonAction(
          "📅",
          function () { window.IncubicsMeetings.open(); },
          "Schedule meeting",
          "Schedule meeting"
        );
      }
      loadStyle("/brand/meetings.css?v=" + version);
      loadStyle("/brand/kanban.css?v=14");
      Promise.all([
        loadScript("/brand/kanban.js?v=14"),
        loadScript("/brand/meetings.js?v=" + version)
      ]).then(addButton);
    }
  });
})();
