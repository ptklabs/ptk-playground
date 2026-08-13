//case 1
extEvalFromHash = function () {
  evalSink(location.hash, "location.hash");
};


//case 2
extEvalFromSearch = function () {
  evalSink(location.search, "location.search");
};


//case 3
extEvalFromWindowName = function () {
  evalSink(window.name, "window.name");
};


//case 4
extEvalFromReferrer = function () {
  evalSink(document.referrer, "document.referrer");
};


//case 5
extEvalFromCookie = function () {
  evalSink(document.cookie, "document.cookie payload");
};


//case 6
extEvalFromLocalStorage = function () {
  try {
    evalSink(localStorage.getItem("payload"), "localStorage.payload");
  } catch (err) {
    console.error("[eval_external_sources] localStorage error", err);
  }
};


//case 7
extEvalFromSessionStorage = function () {
  try {
    evalSink(sessionStorage.getItem("payload"), "sessionStorage.payload");
  } catch (err) {
    console.error("[eval_external_sources] sessionStorage error", err);
  }
};


//case 8
extEvalFromDomField = function () {
  var el = document.getElementById("external-eval-input");
  if (!el) return;
  evalSink(el.value, "dom-input");
};


//case 9
extEvalFromQuerySelector = function () {
  var el = document.querySelector("#external-eval-input");
  if (!el) return;
  evalSink(el.value, "querySelector input");
};


//case 10
extEvalFromJQuery = function () {
  if (typeof $ !== "function") return;
  evalSink($("#external-eval-input").val(), "jquery-val");
};


//case 11
extEvalFromSearchParam = function () {
  var params = new URLSearchParams(location.search);
  evalSink(params.get("payload"), "URLSearchParams payload");
};


//case 12
extEvalFromDocumentURL = function () {
  evalSink(document.URL, "document.URL");
};


//case 13
extEvalFromDocumentURI = function () {
  evalSink(document.documentURI, "document.documentURI");
};
