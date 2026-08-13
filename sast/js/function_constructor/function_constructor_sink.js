function functionConstructorSink(payload, logId) {
  try {
    var fn = new Function(payload);
    fn();
  } catch (err) {
    console.error("[functionConstructorSink] execution error", err);
  }
}
