(function (global) {
  var config = {
    // Set to true if you want to automatically open new tabs when the sink runs.
    openInNewTab: false,
    // Set to true if you want to perform full navigation (location.href = url).
    hardNavigate: false
  };



function normalize(url) {
  try {
    return new URL(url, global.location.href);
  } catch (err) {
    return null;
  }
}

  function openRedirectSink(url, logId) {
    if (!url) {
      return;
    }

    var normalized = normalize(url);
    if (!normalized) {
      return;
    }

    if (config.openInNewTab) {
      global.open(normalized.href, "_blank", "noopener");
    }
    if (config.hardNavigate) {
      global.location.href = normalized.href;
    }
  }

  function setText(id, value) {
    var el = global.document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function sameOriginGuard(url) {
    var normalized = normalize(url);
    if (!normalized) {
      return { allowed: false, message: "Rejected: invalid URL" };
    }
    if (normalized.origin !== global.location.origin) {
      return { allowed: false, message: "Rejected: external origin " + normalized.origin };
    }
    return { allowed: true, message: "Allowed: same-origin " + normalized.pathname };
  }

  global.openRedirectSink = openRedirectSink;
  global.openRedirectConfig = config;
  global.openRedirectUtils = {
    setText: setText,
    sameOriginGuard: sameOriginGuard
  };
})(window);
