//case 1
extFunctionConstructorFromHash = function () {
  functionConstructorSink(location.hash, "hash");
};

//case 2
extFunctionConstructorFromSearch = function () {
  functionConstructorSink(location.search, "search");
};

//case 3
extFunctionConstructorFromWindowName = function () {
  functionConstructorSink(window.name, "window.name");
};


//case 4
extFunctionConstructorFromReferrer = function () {
  functionConstructorSink(document.referrer, "document.referrer");
};


//case 5
extFunctionConstructorFromCookie = function () {
  functionConstructorSink(document.cookie, "document.cookie");
};


//case 6
extFunctionConstructorFromLocalStorage = function () {
  try {
    functionConstructorSink(localStorage.getItem("payload"), "localStorage");
  } catch (err) {
    console.error("[function_constructor_external_sources] localStorage error", err);
  }
};


//case 7
extFunctionConstructorFromSessionStorage = function () {
  try {
    functionConstructorSink(sessionStorage.getItem("payload"), "sessionStorage");
  } catch (err) {
    console.error("[function_constructor_external_sources] sessionStorage error", err);
  }
};


//case 8
extFunctionConstructorFromDomField = function () {
  var el = document.getElementById("external-function-input");
  if (!el) return;
  functionConstructorSink(el.value, "dom-input");
};


//case 9
extFunctionConstructorFromQuerySelector = function () {
  var el = document.querySelector("#external-function-input");
  if (!el) return;
  functionConstructorSink(el.value, "qs-input");
};


//case 10
extFunctionConstructorFromDocumentURL = function () {
  functionConstructorSink(document.URL, "document.URL");
};


//case 11
extFunctionConstructorFromDocumentURI = function () {
  functionConstructorSink(document.documentURI, "document.documentURI");
};


//case 12
extFunctionConstructorFromBaseURI = function () {
  functionConstructorSink(document.baseURI, "document.baseURI");
};
