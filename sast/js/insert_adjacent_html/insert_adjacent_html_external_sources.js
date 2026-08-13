
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

extInsertAdjacentFromHash = function () {
  insertAdjacentHtmlSink(decodeHash(), "external-insertadjacent-target");
};

extInsertAdjacentFromSearch = function () {
  var params = new URLSearchParams(location.search);
  insertAdjacentHtmlSink(params.get("payload"), "external-insertadjacent-target");
};

extInsertAdjacentFromWindowName = function () {
  insertAdjacentHtmlSink(window.name, "external-insertadjacent-target");
};

extInsertAdjacentFromReferrer = function () {
  insertAdjacentHtmlSink(document.referrer, "external-insertadjacent-target");
};

extInsertAdjacentFromCookie = function () {
  var payload = getCookieValue("payload");
  try {
    payload = decodeURIComponent(payload);
  } catch (err) {
    // ignore decode errors
  }
  insertAdjacentHtmlSink(payload, "external-insertadjacent-storage");
};


extInsertAdjacentFromLocalStorage = function () {
  try {
    insertAdjacentHtmlSink(localStorage.getItem("payload"), "external-insertadjacent-storage");
  } catch (err) {
    console.error("[insert_adjacent_html_external_sources] localStorage error", err);
  }
};


extInsertAdjacentFromSessionStorage = function () {
  try {
    insertAdjacentHtmlSink(sessionStorage.getItem("payload"), "external-insertadjacent-storage");
  } catch (err) {
    console.error("[insert_adjacent_html_external_sources] sessionStorage error", err);
  }
};

