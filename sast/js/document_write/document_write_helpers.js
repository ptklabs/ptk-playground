function extWriteFromInput(inputId) {
  var el = document.getElementById(inputId);
  if (!el) return;
  document.write(el.value);
}

function runExtUrlParam() {
  var name = new URLSearchParams(location.search).get('name');
  if (name) document.write("<span>EXT-URLPARAM: " + name + "</span>");
}

function runWrite(input) {
  document.write("<span>EXT-URLPARAM: " + input + "</span>"); 
}

