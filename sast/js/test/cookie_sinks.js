function setCookieString(str) {
  document.cookie = str;
}

function setCookie(name, value, days, attrs) {
  var d = new Date();
  if (typeof days === 'number') d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
  var parts = [name + "=" + value];
  if (typeof days === 'number') parts.push("Expires=" + d.toUTCString());
  parts.push("Path=" + ((attrs && attrs.path) || "/"));
  if (attrs && attrs.domain) parts.push("Domain=" + attrs.domain);
  if (attrs && attrs.secure) parts.push("Secure");
  if (attrs && attrs.sameSite) parts.push("SameSite=" + attrs.sameSite);
  document.cookie = parts.join("; ");
}

