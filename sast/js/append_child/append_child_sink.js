function appendChildSink(payload, targetId) {
  var target = document.body;
  var range = document.createRange();
  var fragment = range.createContextualFragment(payload);
  target.appendChild(fragment);
}
