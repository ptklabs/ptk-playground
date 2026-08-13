
function ensureTarget(targetId) {
  var id = targetId || "insert-adjacent-output";
  var el = document.getElementById(id);
  if (!el) {
    var el1 = document.createElement("div");
    el1.id = id;
    el1.className = "render-target";
    document.body.appendChild(el1);
  }
  return el || el1;
}

function insertAdjacentHtmlSink(payload, targetId, position) {
  var target = ensureTarget(targetId);
  var pos = position || "beforeend";
  target.insertAdjacentHTML(pos, payload == null ? "" : String(payload));
}

function clearTarget(targetId) {
  ensureTarget(targetId).innerHTML = "";
}

function setTextContent(targetId, value) {
  ensureTarget(targetId).textContent = value == null ? "" : String(value);
}


