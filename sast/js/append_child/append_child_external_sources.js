function decodeHash() {
  var hash = location.hash;
  if (!hash) return "";
  var raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

function getCookieValue(name) {
  var parts = (document.cookie || "").split(";");
  for (var i = 0; i < parts.length; i++) {
    var chunk = parts[i].trim();
    if (chunk.indexOf(name + "=") === 0) {
      return chunk.substring(name.length + 1);
    }
  }
  return "";
}

function renderAppendChild(targetId, payload) {
  if (payload == null) return;
  appendChildSink(payload, targetId);
}

extAppendChildFromHash = function () {
  renderAppendChild("external-appendchild-target", decodeHash());
};

extAppendChildFromSearch = function () {
  var params = new URLSearchParams(location.search);
  renderAppendChild("external-appendchild-target", params.get("payload"));
};

extAppendChildFromWindowName = function () {
  renderAppendChild("external-appendchild-target", window.name);
};

extAppendChildFromReferrer = function () {
  renderAppendChild("external-appendchild-target", document.referrer);
};

extAppendChildFromCookie = function () {
  var payload = getCookieValue("payload");
  try {
    payload = decodeURIComponent(payload);
  } catch (err) {}
  renderAppendChild("external-appendchild-storage", payload);
};

extAppendChildFromLocalStorage = function () {
  try {
    renderAppendChild("external-appendchild-storage", localStorage.getItem("payload"));
  } catch (err) {
    console.error("[append_child_external_sources] localStorage error", err);
  }
};

extAppendChildFromSessionStorage = function () {
  try {
    renderAppendChild("external-appendchild-storage", sessionStorage.getItem("payload"));
  } catch (err) {
    console.error("[append_child_external_sources] sessionStorage error", err);
  }
};
