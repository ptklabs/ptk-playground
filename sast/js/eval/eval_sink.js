function evalSink(payload, label) {
  if (payload == null) return;
  var code = typeof payload === "function" ? payload() : payload;
  code = typeof code === "string" ? code : String(code || "");
  if (!code) return;
  eval(code);
}
