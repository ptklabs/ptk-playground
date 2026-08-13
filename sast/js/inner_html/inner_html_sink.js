function innerHtmlSink(payload, targetId) {
  var target = document.getElementById(targetId);
  target.innerHTML = payload == null ? "" : String(payload);
}


function innerHtmlFromStorage(payload, targetId) {
  var target = document.getElementById(targetId);
  target.innerHTML = localStorage.getItem(payload) || "";
}


