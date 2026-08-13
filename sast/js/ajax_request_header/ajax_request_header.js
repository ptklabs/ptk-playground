(function(){
  const logNode = () => document.getElementById('ajax-log');

  function log(message) {
    const node = logNode();
    if (!node) return;
    const time = new Date().toISOString().slice(11, 19);
    node.textContent = `[${time}] ${message}`;
  }

  function buildXHR() {
    const xhr = new XMLHttpRequest();
    const originalSetRequestHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function(name, value) {
      log(`setRequestHeader(${name}, ${value})`);
      return originalSetRequestHeader.apply(xhr, arguments);
    };
    const originalOpen = xhr.open;
    xhr.open = function(method, url) {
      log(`open(${method}, ${url})`);
      return originalOpen.apply(xhr, arguments);
    };
    const originalSend = xhr.send;
    xhr.send = function(body) {
      log(`send(${body || ''})`);
      return originalSend.apply(xhr, arguments);
    };
    return xhr;
  }

  function setHeaderTainted() {
    const headerName = document.getElementById('ajaxHeaderName')?.value || 'X-Trace';
    const headerValue = document.getElementById('ajaxHeaderValue')?.value || '';
    window.location.hash = encodeURIComponent(headerValue);
    const val = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
    const xhr = buildXHR();
    xhr.open('POST', '/api/hash');
    xhr.setRequestHeader(headerName, val);
    xhr.send('payload');
  }


})();
