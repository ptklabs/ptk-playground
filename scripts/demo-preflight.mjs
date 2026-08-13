import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

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

async function waitForHealth(url, child, stderr, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`playground server exited before readiness (${child.exitCode}): ${stderr.value.trim()}`);
    }
    try {
      const response = await request(url);
      if (response.status === 200) return response;
    } catch {
      // The child may still be generating its local certificate or binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`playground server did not become ready within ${timeoutMs} ms: ${stderr.value.trim()}`);
}

function assertLocalRoute(route, label) {
  assert.equal(typeof route, "string", `${label} must be a string`);
  assert.notEqual(route.trim(), "", `${label} must not be empty`);
  assert.doesNotMatch(route, /^\/\//, `${label} must not be scheme-relative`);
  const base = new URL("https://playground.invalid/ptk-playground/");
  const resolved = new URL(route, base);
  assert.equal(resolved.origin, base.origin, `${label} must stay on the fixture origin`);
  assert.equal(resolved.username, "", `${label} must not contain URL credentials`);
  assert.equal(resolved.password, "", `${label} must not contain URL credentials`);
}

const [httpPort, httpsPort] = await Promise.all([allocatePort(), allocatePort()]);
assert.notEqual(httpPort, httpsPort, "preflight ports must be distinct");

const stdout = { value: "" };
const stderr = { value: "" };
const child = spawn(process.execPath, ["passive/server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PTK_PLAYGROUND_HOST: host,
    PTK_PASSIVE_HTTP_PORT: String(httpPort),
    PTK_PASSIVE_HTTPS_PORT: String(httpsPort)
  },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => { stdout.value += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr.value += chunk.toString(); });

const httpOrigin = `http://${host}:${httpPort}`;
const httpsOrigin = `https://${host}:${httpsPort}`;

try {
  const health = await waitForHealth(`${httpOrigin}/healthz`, child, stderr);
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

  const [demoPage, scannerPage, demoCatalogResponse, scannerCatalogResponse] = await Promise.all([
    request(`${httpOrigin}/demo/`),
    request(`${httpOrigin}/scanner/`),
    request(`${httpOrigin}/catalog/demo.json`),
    request(`${httpOrigin}/catalog/scanner-targets.json`)
  ]);
  for (const [label, response] of Object.entries({ demoPage, scannerPage, demoCatalogResponse, scannerCatalogResponse })) {
    assert.equal(response.status, 200, `${label} must return HTTP 200`);
  }

  const demoCatalog = JSON.parse(demoCatalogResponse.body);
  assert.equal(demoCatalog.durationMinutes, 12, "curated demo duration must stay frozen");
  assert.equal(demoCatalog.chapters.length, 3, "curated demo must keep three chapters");
  const engines = new Set(demoCatalog.chapters.flatMap((chapter) => chapter.evidence.map((entry) => entry.engine)));
  for (const engine of ["DAST", "SAST", "IAST", "SCA"]) {
    assert.ok(engines.has(engine), `curated demo must cover ${engine}`);
  }

  const scannerCatalog = JSON.parse(scannerCatalogResponse.body);
  for (const mission of scannerCatalog.missions) {
    assertLocalRoute(mission.route, `${mission.id}.route`);
    assert.ok(Array.isArray(mission.targets), `${mission.id}.targets must be an array`);
    assert.deepEqual(
      mission.targets.map((target) => target.variant).sort(),
      ["repaired", "review"],
      `${mission.id} must expose one review and one repaired target`
    );
    for (const target of mission.targets) {
      assertLocalRoute(target.route, `${mission.id}.targets.${target.variant}.route`);
      if (target.request?.route) {
        assertLocalRoute(target.request.route, `${mission.id}.targets.${target.variant}.request.route`);
      }
    }
  }

  const reviewPage = await request(`${httpsOrigin}/targets/session-bound-order-search/vulnerable/`);
  const repairedPage = await request(`${httpsOrigin}/targets/session-bound-order-search/fixed/`);
  assert.equal(reviewPage.status, 200, "order-search review page must be available over HTTPS");
  assert.equal(repairedPage.status, 200, "order-search repaired page must be available over HTTPS");
  const reviewCookie = String(reviewPage.headers["set-cookie"]?.[0] || "").split(";", 1)[0];
  const repairedCookie = String(repairedPage.headers["set-cookie"]?.[0] || "").split(";", 1)[0];
  assert.equal(reviewCookie, "ptk_order_session=active", "review session cookie must be scoped and available");
  assert.equal(repairedCookie, "ptk_order_session=active", "repaired session cookie must be scoped and available");

  const body = "query=prepared%27";
  const requestOptions = (cookie) => ({
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(body),
      "x-playground-request": "order-search",
      cookie
    },
    body
  });
  const reviewResult = await request(
    `${httpsOrigin}/targets/session-bound-order-search/vulnerable/api/search`,
    requestOptions(reviewCookie)
  );
  const repairedResult = await request(
    `${httpsOrigin}/targets/session-bound-order-search/fixed/api/search`,
    requestOptions(repairedCookie)
  );
  assert.equal(reviewResult.status, 500, "review POST must expose the bounded SQL error oracle");
  assert.equal(JSON.parse(reviewResult.body).code, "ORDER_QUERY_SYNTAX");
  assert.equal(repairedResult.status, 200, "repaired POST must stay clean for the same input");
  assert.equal(JSON.parse(repairedResult.body).ok, true);

  console.log("OWASP PTK Playground demo preflight: PASS");
  console.log(`  Local demo: ${httpOrigin}/demo/`);
  console.log(`  Scanner directory: ${httpOrigin}/scanner/`);
  console.log(`  HTTPS active target: ${httpsOrigin}/targets/session-bound-order-search/vulnerable/`);
  console.log("  Engines represented: DAST, SAST, IAST, SCA");
  console.log("  Session-bound DAST review/control oracle: PASS");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
