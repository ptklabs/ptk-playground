import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

const httpOrigin = process.env.PTK_PLAYGROUND_HTTP_ORIGIN || "http://127.0.0.1:3080";
const httpsOrigin = process.env.PTK_PLAYGROUND_HTTPS_ORIGIN || "https://127.0.0.1:3443";

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(target, {
      method: options.method || "GET",
      headers: options.headers || {},
      rejectUnauthorized: target.protocol === "https:" ? false : undefined
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.once("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForHealth(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await request(`${httpOrigin}/healthz`);
      if (response.status === 200) return response;
      lastError = new Error(`health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`container did not become healthy: ${lastError?.message || "timeout"}`);
}

const health = await waitForHealth();
const healthBody = JSON.parse(health.body);
assert.deepEqual({
  ok: healthBody.ok,
  service: healthBody.service,
  mode: healthBody.mode,
  protocol: healthBody.protocol,
  httpsAvailable: healthBody.httpsAvailable
}, {
  ok: true,
  service: "owasp-ptk-playground",
  mode: "route-aware",
  protocol: "http",
  httpsAvailable: true
});

const [playPage, playlistResponse, httpsHealth] = await Promise.all([
  request(`${httpOrigin}/play/?playlist=spa-deep-dive`),
  request(`${httpOrigin}/catalog/playlists.json`),
  request(`${httpsOrigin}/healthz`)
]);
assert.equal(playPage.status, 200, "Play must be available over container HTTP");
assert.equal(playlistResponse.status, 200, "playlist catalogue must be available");
assert.equal(httpsHealth.status, 200, "health must be available over container HTTPS");
assert.equal(JSON.parse(httpsHealth.body).protocol, "https");
const playlists = JSON.parse(playlistResponse.body);
assert.ok(
  playlists.playlists.some((playlist) => playlist.id === "spa-deep-dive"),
  "SPA Deep Dive must be present in the container catalogue"
);

const [reviewPage, repairedPage] = await Promise.all([
  request(`${httpsOrigin}/targets/session-bound-order-search/vulnerable/`),
  request(`${httpsOrigin}/targets/session-bound-order-search/fixed/`)
]);
assert.equal(reviewPage.status, 200, "DAST review page must be available over HTTPS");
assert.equal(repairedPage.status, 200, "DAST repaired page must be available over HTTPS");
const reviewCookie = String(reviewPage.headers["set-cookie"]?.[0] || "").split(";", 1)[0];
const repairedCookie = String(repairedPage.headers["set-cookie"]?.[0] || "").split(";", 1)[0];
assert.equal(reviewCookie, "ptk_order_session=active");
assert.equal(repairedCookie, "ptk_order_session=active");

const body = "query=prepared%27";
const post = (cookie) => ({
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": Buffer.byteLength(body),
    "x-playground-request": "order-search",
    cookie
  },
  body
});
const [reviewResult, repairedResult] = await Promise.all([
  request(`${httpsOrigin}/targets/session-bound-order-search/vulnerable/api/search`, post(reviewCookie)),
  request(`${httpsOrigin}/targets/session-bound-order-search/fixed/api/search`, post(repairedCookie))
]);
assert.equal(reviewResult.status, 500, "review route must retain the bounded DAST oracle");
assert.equal(JSON.parse(reviewResult.body).code, "ORDER_QUERY_SYNTAX");
assert.equal(repairedResult.status, 200, "repaired route must remain clean");
assert.equal(JSON.parse(repairedResult.body).ok, true);

console.log("OWASP PTK Playground container smoke: PASS");
console.log(`  HTTP runtime: ${httpOrigin}/`);
console.log(`  HTTPS runtime: ${httpsOrigin}/`);
console.log("  SPA Deep Dive catalogue: PASS");
console.log("  Session-bound DAST review/control oracle: PASS");
