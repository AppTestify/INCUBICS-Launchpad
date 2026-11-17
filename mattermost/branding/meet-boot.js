(function () {
  function meetingToken() {
    var match = location.pathname.match(/^\/meet\/([a-z0-9]{12})\/?$/);
    return match ? match[1] : "";
  }

  function rescue() {
    var token = meetingToken();
    if (!token) return;
    location.replace("/incubics/channels/meet" + token);
  }

  rescue();
  var push = history.pushState;
  var replace = history.replaceState;
  history.pushState = function () {
    var result = push.apply(history, arguments);
    rescue();
    return result;
  };
  history.replaceState = function () {
    var result = replace.apply(history, arguments);
    rescue();
    return result;
  };
  window.addEventListener("popstate", rescue);
})();
