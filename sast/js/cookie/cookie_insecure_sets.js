
function runCookieFromHashNoAttrs() {
  var v = location.hash ? location.hash.slice(1) : "";
  // No Secure/SameSite, raw value
  setCookieString("ptk_ext_hash=" + v + "; Path=/");
}
