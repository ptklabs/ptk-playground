// helper to read our cookie
function getCookieByName(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

function getLocationSearch() {
  return location.search ? location.search.substring(1) : '';
}

function getLocationHash() {
  var q = location.hash ? location.hash.slice(1) : '';
  return q;
}

function getElementValue(name) {
  return document.getElementById(name).value;
}
