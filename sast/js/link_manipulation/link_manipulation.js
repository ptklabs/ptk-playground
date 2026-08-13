(function (global) {
  var doc = global.document;

  function sanitise(value) {
    return value;
  }


  function resolveLink(id) {
    var el = doc.getElementById(id);
    if (!el) {
      console.warn("[linkCases] link not found:", id);
    }
    return el;
  }

  function normaliseValue(value) {
    if (value === undefined || value === null || value === "") {
      return "#";
    }
    return String(value);
  }

  function setLink(id, value, reason) {
    var link = resolveLink(id);
    if (!link) return;
    link.setAttribute("href", value);
    link.textContent = value;

  }

  function allowlist(url, origins) {
    var value = normaliseValue(url);
    try {
      var parsed = new URL(value, global.location.href);
      if (origins.indexOf(parsed.origin) !== -1) {
        return parsed.href;
      }
      return global.location.origin + "/blocked?dest=" + encodeURIComponent(parsed.href);
    } catch (err) {
      return global.location.origin + "/blocked?dest=" + encodeURIComponent(value);
    }
  }

  function applySafe(id, value) {
    var link = resolveLink(id);
    if (!link) return;
    var href = normaliseValue(value);
    link.setAttribute("href", href);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.textContent = href;

  }

  function sanitise(url) {
    var value = normaliseValue(url).trim();
    var lowered = value.toLowerCase();
    if (lowered.startsWith("javascript:") || lowered.startsWith("data:") || lowered.startsWith("vbscript:")) {
      return "#";
    }
    return value;
  }

  function readCookie(name) {
    var cookies = (doc.cookie || "").split(";");
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf(name + "=") === 0) {
        return c.substring(name.length + 1);
      }
    }
    return "";
  }

  function getCookie() {
    var value = readCookie("link_payload");
    try { value = decodeURIComponent(value); } catch (err) { /* keep raw */ }
    return value;
  }

  function getLocal() {
    try {
      return global.localStorage.getItem("link_payload") || "";
    } catch (err) {
      console.log("localStorage unavailable: " + err.message);
      return "";
    }
  }

  function bootstrap() {
    setLink("link-preview", "#", "Initial state");
    try {
      if (!global.localStorage.getItem("link_payload")) {
        global.localStorage.setItem("link_payload", "https://evil.example/from-localStorage");
      }
    } catch (err) { /* ignore */ }
    try {
      doc.cookie = "link_payload=https%3A%2F%2Fevil.example%2Ffrom-cookie; path=/";
    } catch (err) { /* ignore */ }
  }

  doc.addEventListener("DOMContentLoaded", bootstrap);

  global.linkCases = {
    setLink: setLink,
    allowlist: allowlist,
    applySafe: applySafe,
    sanitise: sanitise,
    getCookie: getCookie,
    getLocal: getLocal
  };
})(window);
