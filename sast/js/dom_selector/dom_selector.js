 const selectorSink = function(sinkId, status) {
  var sink = document.querySelectorAll(sinkId);
  try {
    sink.textContent = status;
  } catch (err) {
    // ignore insert errors
  }
}



function extSelectorFromCookie() {
  var payload = getCookieByName("payload") || "payload";
  try {
    payload = decodeURIComponent(payload);
  } catch (err) {
    // ignore decode errors
  }
  selectorSink(payload, "external-insertadjacent-storage");
}
