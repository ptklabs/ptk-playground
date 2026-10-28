import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleWorkshopLabApi } from "./workshop-labs.mjs";
import { handleRealLabsApi, serveReflectedXss, serveAttributeXss } from "./real-labs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const playgroundRoot = path.resolve(__dirname, "..");
const passiveRoot = __dirname;
const HTTP_PORT = Number(process.env.PTK_PASSIVE_HTTP_PORT || 3080);
const HTTPS_PORT = Number(process.env.PTK_PASSIVE_HTTPS_PORT || 3443);
const LISTEN_HOST = String(process.env.PTK_PLAYGROUND_HOST || "127.0.0.1").trim() || "127.0.0.1";
const DISPLAY_HOST = LISTEN_HOST === "127.0.0.1" ? "localhost" : LISTEN_HOST;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const fileResponse = (file, options = {}) => ({ file, ...options });
const playgroundFileResponse = (file, options = {}) => ({ file, root: playgroundRoot, ...options });
const bodyResponse = (body, options = {}) => ({ body, ...options });

const secureHeaderCanaryHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Set-Cookie": "ptk_header_control=1; Path=/; Secure; HttpOnly; SameSite=Strict"
});

const orderSearchPageHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Set-Cookie": "ptk_order_session=active; Path=/targets/session-bound-order-search/; Secure; HttpOnly; SameSite=Strict"
});

const historyOrderPageHeaders = (isHttps) => ({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Set-Cookie": `ptk_history_order_session=active; Path=/targets/history-order-router/; HttpOnly; SameSite=Strict${isHttps ? "; Secure" : ""}`
});

const childContextPageHeaders = (isHttps) => ({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Set-Cookie": `ptk_child_context_session=active; Path=/targets/same-origin-child-tab/; HttpOnly; SameSite=Strict${isHttps ? "; Secure" : ""}`
});

const xssDomHeaders = (vulnerable) => ({
  "Content-Security-Policy": `default-src 'none'; script-src 'self'${vulnerable ? " 'unsafe-inline'" : ''}; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
});

const xssQueryCodeHeaders = (vulnerable) => ({
  "Content-Security-Policy": `default-src 'none'; script-src 'self'${vulnerable ? " 'unsafe-eval'" : ''}; style-src 'self'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
});

const routeMap = new Map([
  ["/", playgroundFileResponse("index.html")],
  ["/index.html", playgroundFileResponse("index.html")],
  ["/passive/", fileResponse("index.html")],
  ["/passive/index.html", fileResponse("index.html")],
  ["/passive/css/index.css", fileResponse("css/index.css", { contentType: "text/css; charset=utf-8" })],
  ["/assets/css/playground.css", playgroundFileResponse("assets/css/playground.css", { contentType: "text/css; charset=utf-8" })],
  ["/assets/js/playground.js", playgroundFileResponse("assets/js/playground.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/catalog/cases.json", playgroundFileResponse("catalog/cases.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/missions.json", playgroundFileResponse("catalog/missions.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/scanner-targets.json", playgroundFileResponse("catalog/scanner-targets.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/demo.json", playgroundFileResponse("catalog/demo.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/challenges.json", playgroundFileResponse("catalog/challenges.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/families.json", playgroundFileResponse("catalog/families.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/playlists.json", playgroundFileResponse("catalog/playlists.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/source-ledger.json", playgroundFileResponse("catalog/source-ledger.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/legacy-routes.json", playgroundFileResponse("catalog/legacy-routes.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/sast-atomic.json", playgroundFileResponse("catalog/sast-atomic.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/iast-atomic.json", playgroundFileResponse("catalog/iast-atomic.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/dast-contracts.json", playgroundFileResponse("catalog/dast-contracts.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/sca-dependencies.json", playgroundFileResponse("catalog/sca-dependencies.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/generated/scanner-targets.json", playgroundFileResponse("catalog/generated/scanner-targets.json", { contentType: "application/json; charset=utf-8" })],
  ["/catalog/generated/counts.json", playgroundFileResponse("catalog/generated/counts.json", { contentType: "application/json; charset=utf-8" })],
  ["/assets/js/catalogue-app.js", playgroundFileResponse("assets/js/catalogue-app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/jwt-storage-lab.js", playgroundFileResponse("assets/js/jwt-storage-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/jwt-dast-lab.js", playgroundFileResponse("assets/js/jwt-dast-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/access-control-lab.js", playgroundFileResponse("assets/js/access-control-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/graphql-lab.js", playgroundFileResponse("assets/js/graphql-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/stored-xss-lab.js", playgroundFileResponse("assets/js/stored-xss-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/jwt-nested-lab.js", playgroundFileResponse("assets/js/jwt-nested-lab.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/js/real-labs.js", playgroundFileResponse("assets/js/real-labs.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/labs/", playgroundFileResponse("labs/index.html")],
  ["/labs/jwt/", playgroundFileResponse("labs/jwt/index.html")],
  ["/labs/sql/", playgroundFileResponse("labs/sql/index.html")],
  ["/labs/browser-context/", playgroundFileResponse("labs/browser-context/index.html")],
  ["/labs/spa/", playgroundFileResponse("labs/spa/index.html")],
  ["/labs/access-control/", playgroundFileResponse("labs/access-control/index.html")],
  ["/labs/xss/", playgroundFileResponse("labs/xss/index.html")],
  ["/labs/support-widget/", playgroundFileResponse("labs/support-widget/index.html")],
  ["/labs/imported-request-preferences/", playgroundFileResponse("labs/imported-request-preferences/index.html")],
  ["/labs/on-demand-analytics/", playgroundFileResponse("labs/on-demand-analytics/index.html")],
  ["/labs/session-bound-order-search/", playgroundFileResponse("labs/session-bound-order-search/index.html")],
  ["/labs/idor-read/", playgroundFileResponse("labs/idor-read/index.html")],
  ["/labs/graphql-order/", playgroundFileResponse("labs/graphql-order/index.html")],
  ["/labs/idor-write/", playgroundFileResponse("labs/idor-write/index.html")],
  ["/labs/stored-xss/", playgroundFileResponse("labs/stored-xss/index.html")],
  ["/labs/jwt-nested-weak-secret/", playgroundFileResponse("labs/jwt-nested-weak-secret/index.html")],
  ["/labs/jwt-none/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/jwt-alg-confusion/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/jwt-null-signature/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/jwt-jwk-injection/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/sql-single-quote/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/sql-double-quote/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/sql-auth-bypass/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/xss-reflected/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/xss-dom/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/xss-attribute/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/labs/xss-query-code/", playgroundFileResponse("labs/real-lab/index.html")],
  ["/campaigns/idor-read/", playgroundFileResponse("campaigns/idor-read/index.html")],
  ["/campaigns/graphql-order/", playgroundFileResponse("campaigns/graphql-order/index.html")],
  ["/campaigns/idor-write/", playgroundFileResponse("campaigns/idor-write/index.html")],
  ["/campaigns/stored-xss/", playgroundFileResponse("campaigns/stored-xss/index.html")],
  ["/campaigns/jwt-nested-weak-secret/", playgroundFileResponse("campaigns/jwt-nested-weak-secret/index.html")],
  ["/campaigns/jwt-none/", playgroundFileResponse("campaigns/jwt-none/index.html")],
  ["/campaigns/jwt-alg-confusion/", playgroundFileResponse("campaigns/jwt-alg-confusion/index.html")],
  ["/campaigns/jwt-null-signature/", playgroundFileResponse("campaigns/jwt-null-signature/index.html")],
  ["/campaigns/jwt-jwk-injection/", playgroundFileResponse("campaigns/jwt-jwk-injection/index.html")],
  ["/campaigns/sql-single-quote/", playgroundFileResponse("campaigns/sql-single-quote/index.html")],
  ["/campaigns/sql-double-quote/", playgroundFileResponse("campaigns/sql-double-quote/index.html")],
  ["/campaigns/sql-auth-bypass/", playgroundFileResponse("campaigns/sql-auth-bypass/index.html")],
  ["/campaigns/xss-reflected/", playgroundFileResponse("campaigns/xss-reflected/index.html")],
  ["/campaigns/xss-dom/", playgroundFileResponse("campaigns/xss-dom/index.html")],
  ["/campaigns/xss-attribute/", playgroundFileResponse("campaigns/xss-attribute/index.html")],
  ["/campaigns/xss-query-code/", playgroundFileResponse("campaigns/xss-query-code/index.html")],
  ["/targets/access-control/idor-read/vulnerable/", playgroundFileResponse("targets/access-control/idor-read/index.html")],
  ["/targets/access-control/idor-read/fixed/", playgroundFileResponse("targets/access-control/idor-read/index.html")],
  ["/targets/access-control/idor-write/vulnerable/", playgroundFileResponse("targets/access-control/idor-write/index.html")],
  ["/targets/access-control/idor-write/fixed/", playgroundFileResponse("targets/access-control/idor-write/index.html")],
  ["/targets/graphql/order/vulnerable/", playgroundFileResponse("targets/graphql/order/vulnerable/index.html")],
  ["/targets/graphql/order/fixed/", playgroundFileResponse("targets/graphql/order/fixed/index.html")],
  ["/targets/stored-xss/vulnerable/", playgroundFileResponse("targets/stored-xss/vulnerable/index.html")],
  ["/targets/stored-xss/vulnerable/render.js", playgroundFileResponse("targets/stored-xss/vulnerable/render.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/stored-xss/fixed/", playgroundFileResponse("targets/stored-xss/fixed/index.html")],
  ["/targets/stored-xss/fixed/render.js", playgroundFileResponse("targets/stored-xss/fixed/render.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/jwt-lab/nested-json-weak-secret/", playgroundFileResponse("targets/jwt-lab/nested-json-weak-secret/index.html")],
  ["/targets/xss/dom/vulnerable/", playgroundFileResponse("targets/xss/dom/vulnerable/index.html", { headers: xssDomHeaders(true) })],
  ["/targets/xss/dom/vulnerable/app.js", playgroundFileResponse("targets/xss/dom/vulnerable/app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/xss/dom/fixed/", playgroundFileResponse("targets/xss/dom/fixed/index.html", { headers: xssDomHeaders(false) })],
  ["/targets/xss/dom/fixed/app.js", playgroundFileResponse("targets/xss/dom/fixed/app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/xss/query-code/vulnerable/", playgroundFileResponse("targets/xss/query-code/vulnerable/index.html", { headers: xssQueryCodeHeaders(true) })],
  ["/targets/xss/query-code/vulnerable/app.js", playgroundFileResponse("targets/xss/query-code/vulnerable/app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/xss/query-code/fixed/", playgroundFileResponse("targets/xss/query-code/fixed/index.html", { headers: xssQueryCodeHeaders(false) })],
  ["/targets/xss/query-code/fixed/app.js", playgroundFileResponse("targets/xss/query-code/fixed/app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/play/", playgroundFileResponse("play/index.html")],
  ["/play/index.html", playgroundFileResponse("play/index.html")],
  ["/explore/", playgroundFileResponse("explore/index.html")],
  ["/explore/index.html", playgroundFileResponse("explore/index.html")],
  ["/jwt/", playgroundFileResponse("jwt/index.html")],
  ["/jwt/index.html", playgroundFileResponse("jwt/index.html")],
  ["/jwt/storage/vulnerable/", playgroundFileResponse("jwt/storage/vulnerable/index.html")],
  ["/jwt/storage/vulnerable/index.html", playgroundFileResponse("jwt/storage/vulnerable/index.html")],
  ["/jwt/storage/fixed/", playgroundFileResponse("jwt/storage/fixed/index.html")],
  ["/jwt/storage/fixed/index.html", playgroundFileResponse("jwt/storage/fixed/index.html")],
  ["/demo/", playgroundFileResponse("demo/index.html")],
  ["/demo/index.html", playgroundFileResponse("demo/index.html")],
  ["/scanner/", playgroundFileResponse("scanner/index.html")],
  ["/scanner/index.html", playgroundFileResponse("scanner/index.html")],
  ["/campaigns/", playgroundFileResponse("campaigns/index.html")],
  ["/campaigns/index.html", playgroundFileResponse("campaigns/index.html")],
  ["/campaigns/support-widget/", playgroundFileResponse("campaigns/support-widget/index.html")],
  ["/campaigns/support-widget/index.html", playgroundFileResponse("campaigns/support-widget/index.html")],
  ["/campaigns/deployment-response-boundary/", playgroundFileResponse("campaigns/deployment-response-boundary/index.html")],
  ["/campaigns/deployment-response-boundary/index.html", playgroundFileResponse("campaigns/deployment-response-boundary/index.html")],
  ["/campaigns/session-bound-order-search/", playgroundFileResponse("campaigns/session-bound-order-search/index.html")],
  ["/campaigns/session-bound-order-search/index.html", playgroundFileResponse("campaigns/session-bound-order-search/index.html")],
  ["/campaigns/on-demand-analytics/", playgroundFileResponse("campaigns/on-demand-analytics/index.html")],
  ["/campaigns/on-demand-analytics/index.html", playgroundFileResponse("campaigns/on-demand-analytics/index.html")],
  ["/campaigns/saved-workspace/", playgroundFileResponse("campaigns/saved-workspace/index.html")],
  ["/campaigns/saved-workspace/index.html", playgroundFileResponse("campaigns/saved-workspace/index.html")],
  ["/campaigns/live-profile-preview/", playgroundFileResponse("campaigns/live-profile-preview/index.html")],
  ["/campaigns/live-profile-preview/index.html", playgroundFileResponse("campaigns/live-profile-preview/index.html")],
  ["/campaigns/transient-route-notice/", playgroundFileResponse("campaigns/transient-route-notice/index.html")],
  ["/campaigns/transient-route-notice/index.html", playgroundFileResponse("campaigns/transient-route-notice/index.html")],
  ["/campaigns/imported-request-preferences/", playgroundFileResponse("campaigns/imported-request-preferences/index.html")],
  ["/campaigns/imported-request-preferences/index.html", playgroundFileResponse("campaigns/imported-request-preferences/index.html")],
  ["/campaigns/history-order-router/", playgroundFileResponse("campaigns/history-order-router/index.html")],
  ["/campaigns/history-order-router/index.html", playgroundFileResponse("campaigns/history-order-router/index.html")],
  ["/campaigns/lazy-route-module/", playgroundFileResponse("campaigns/lazy-route-module/index.html")],
  ["/campaigns/lazy-route-module/index.html", playgroundFileResponse("campaigns/lazy-route-module/index.html")],
  ["/campaigns/same-origin-child-tab/", playgroundFileResponse("campaigns/same-origin-child-tab/index.html")],
  ["/campaigns/same-origin-child-tab/index.html", playgroundFileResponse("campaigns/same-origin-child-tab/index.html")],
  ["/targets/support-widget/vulnerable/", playgroundFileResponse("targets/support-widget/vulnerable/index.html")],
  ["/targets/support-widget/vulnerable/index.html", playgroundFileResponse("targets/support-widget/vulnerable/index.html")],
  ["/targets/support-widget/vulnerable/widget.js", playgroundFileResponse("targets/support-widget/vulnerable/widget.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/support-widget/fixed/", playgroundFileResponse("targets/support-widget/fixed/index.html")],
  ["/targets/support-widget/fixed/index.html", playgroundFileResponse("targets/support-widget/fixed/index.html")],
  ["/targets/support-widget/fixed/widget.js", playgroundFileResponse("targets/support-widget/fixed/widget.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/on-demand-analytics/vulnerable/", playgroundFileResponse("targets/on-demand-analytics/vulnerable/index.html")],
  ["/targets/on-demand-analytics/vulnerable/index.html", playgroundFileResponse("targets/on-demand-analytics/vulnerable/index.html")],
  ["/targets/on-demand-analytics/fixed/", playgroundFileResponse("targets/on-demand-analytics/fixed/index.html")],
  ["/targets/on-demand-analytics/fixed/index.html", playgroundFileResponse("targets/on-demand-analytics/fixed/index.html")],
  ["/targets/on-demand-analytics/analytics-loader.js", playgroundFileResponse("targets/on-demand-analytics/analytics-loader.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/saved-workspace/workspace-editor.js", playgroundFileResponse("targets/saved-workspace/workspace-editor.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/saved-workspace/vulnerable/", playgroundFileResponse("targets/saved-workspace/vulnerable/index.html")],
  ["/targets/saved-workspace/vulnerable/index.html", playgroundFileResponse("targets/saved-workspace/vulnerable/index.html")],
  ["/targets/saved-workspace/vulnerable/dashboard.html", playgroundFileResponse("targets/saved-workspace/vulnerable/dashboard.html")],
  ["/targets/saved-workspace/vulnerable/dashboard.js", playgroundFileResponse("targets/saved-workspace/vulnerable/dashboard.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/saved-workspace/fixed/", playgroundFileResponse("targets/saved-workspace/fixed/index.html")],
  ["/targets/saved-workspace/fixed/index.html", playgroundFileResponse("targets/saved-workspace/fixed/index.html")],
  ["/targets/saved-workspace/fixed/dashboard.html", playgroundFileResponse("targets/saved-workspace/fixed/dashboard.html")],
  ["/targets/saved-workspace/fixed/dashboard.js", playgroundFileResponse("targets/saved-workspace/fixed/dashboard.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/live-profile-preview/profile.json", playgroundFileResponse("targets/live-profile-preview/profile.json", { contentType: "application/json; charset=utf-8" })],
  ["/targets/live-profile-preview/vulnerable/", playgroundFileResponse("targets/live-profile-preview/vulnerable/index.html")],
  ["/targets/live-profile-preview/vulnerable/index.html", playgroundFileResponse("targets/live-profile-preview/vulnerable/index.html")],
  ["/targets/live-profile-preview/vulnerable/profile-preview.js", playgroundFileResponse("targets/live-profile-preview/vulnerable/profile-preview.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/live-profile-preview/fixed/", playgroundFileResponse("targets/live-profile-preview/fixed/index.html")],
  ["/targets/live-profile-preview/fixed/index.html", playgroundFileResponse("targets/live-profile-preview/fixed/index.html")],
  ["/targets/live-profile-preview/fixed/profile-preview.js", playgroundFileResponse("targets/live-profile-preview/fixed/profile-preview.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/transient-route-notice/vulnerable/", playgroundFileResponse("targets/transient-route-notice/vulnerable/index.html")],
  ["/targets/transient-route-notice/vulnerable/index.html", playgroundFileResponse("targets/transient-route-notice/vulnerable/index.html")],
  ["/targets/transient-route-notice/vulnerable/route-notice.js", playgroundFileResponse("targets/transient-route-notice/vulnerable/route-notice.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/transient-route-notice/fixed/", playgroundFileResponse("targets/transient-route-notice/fixed/index.html")],
  ["/targets/transient-route-notice/fixed/index.html", playgroundFileResponse("targets/transient-route-notice/fixed/index.html")],
  ["/targets/transient-route-notice/fixed/route-notice.js", playgroundFileResponse("targets/transient-route-notice/fixed/route-notice.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/imported-request-preferences/preview.json", playgroundFileResponse("targets/imported-request-preferences/preview.json", { contentType: "application/json; charset=utf-8" })],
  ["/targets/imported-request-preferences/vulnerable/", playgroundFileResponse("targets/imported-request-preferences/vulnerable/index.html")],
  ["/targets/imported-request-preferences/vulnerable/index.html", playgroundFileResponse("targets/imported-request-preferences/vulnerable/index.html")],
  ["/targets/imported-request-preferences/vulnerable/request-preferences.js", playgroundFileResponse("targets/imported-request-preferences/vulnerable/request-preferences.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/imported-request-preferences/fixed/", playgroundFileResponse("targets/imported-request-preferences/fixed/index.html")],
  ["/targets/imported-request-preferences/fixed/index.html", playgroundFileResponse("targets/imported-request-preferences/fixed/index.html")],
  ["/targets/imported-request-preferences/fixed/request-preferences.js", playgroundFileResponse("targets/imported-request-preferences/fixed/request-preferences.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/history-order-router/vulnerable/", playgroundFileResponse("targets/history-order-router/vulnerable/index.html", { headers: historyOrderPageHeaders })],
  ["/targets/history-order-router/vulnerable/index.html", playgroundFileResponse("targets/history-order-router/vulnerable/index.html", { headers: historyOrderPageHeaders })],
  ["/targets/history-order-router/vulnerable/history-order-router.js", playgroundFileResponse("targets/history-order-router/vulnerable/history-order-router.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/history-order-router/fixed/", playgroundFileResponse("targets/history-order-router/fixed/index.html", { headers: historyOrderPageHeaders })],
  ["/targets/history-order-router/fixed/index.html", playgroundFileResponse("targets/history-order-router/fixed/index.html", { headers: historyOrderPageHeaders })],
  ["/targets/history-order-router/fixed/history-order-router.js", playgroundFileResponse("targets/history-order-router/fixed/history-order-router.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/lazy-route-module/vulnerable/", playgroundFileResponse("targets/lazy-route-module/vulnerable/index.html")],
  ["/targets/lazy-route-module/vulnerable/index.html", playgroundFileResponse("targets/lazy-route-module/vulnerable/index.html")],
  ["/targets/lazy-route-module/vulnerable/lazy-route-app.js", playgroundFileResponse("targets/lazy-route-module/vulnerable/lazy-route-app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/lazy-route-module/vulnerable/analytics-route.js", playgroundFileResponse("targets/lazy-route-module/vulnerable/analytics-route.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/lazy-route-module/fixed/", playgroundFileResponse("targets/lazy-route-module/fixed/index.html")],
  ["/targets/lazy-route-module/fixed/index.html", playgroundFileResponse("targets/lazy-route-module/fixed/index.html")],
  ["/targets/lazy-route-module/fixed/lazy-route-app.js", playgroundFileResponse("targets/lazy-route-module/fixed/lazy-route-app.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/lazy-route-module/fixed/analytics-route.js", playgroundFileResponse("targets/lazy-route-module/fixed/analytics-route.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/same-origin-child-tab/vulnerable/", playgroundFileResponse("targets/same-origin-child-tab/vulnerable/index.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/vulnerable/index.html", playgroundFileResponse("targets/same-origin-child-tab/vulnerable/index.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/vulnerable/child-tab-launcher.js", playgroundFileResponse("targets/same-origin-child-tab/vulnerable/child-tab-launcher.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/same-origin-child-tab/vulnerable/child.html", playgroundFileResponse("targets/same-origin-child-tab/vulnerable/child.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/vulnerable/child-runtime.js", playgroundFileResponse("targets/same-origin-child-tab/vulnerable/child-runtime.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/same-origin-child-tab/fixed/", playgroundFileResponse("targets/same-origin-child-tab/fixed/index.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/fixed/index.html", playgroundFileResponse("targets/same-origin-child-tab/fixed/index.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/fixed/child-tab-launcher.js", playgroundFileResponse("targets/same-origin-child-tab/fixed/child-tab-launcher.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/same-origin-child-tab/fixed/child.html", playgroundFileResponse("targets/same-origin-child-tab/fixed/child.html", { headers: childContextPageHeaders })],
  ["/targets/same-origin-child-tab/fixed/child-runtime.js", playgroundFileResponse("targets/same-origin-child-tab/fixed/child-runtime.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/same-origin-child-tab/control/", playgroundFileResponse("targets/same-origin-child-tab/control/index.html")],
  ["/targets/same-origin-child-tab/control/index.html", playgroundFileResponse("targets/same-origin-child-tab/control/index.html")],
  ["/targets/angular-expression-dependency/review/", playgroundFileResponse("targets/angular-expression-dependency/review/index.html")],
  ["/targets/angular-expression-dependency/review/index.html", playgroundFileResponse("targets/angular-expression-dependency/review/index.html")],
  ["/targets/angular-expression-dependency/fixed/", playgroundFileResponse("targets/angular-expression-dependency/fixed/index.html")],
  ["/targets/angular-expression-dependency/fixed/index.html", playgroundFileResponse("targets/angular-expression-dependency/fixed/index.html")],
  ["/targets/angular-expression-dependency/expression.js", playgroundFileResponse("targets/angular-expression-dependency/expression.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/jwt-lab/dast/", playgroundFileResponse("targets/jwt-lab/dast/index.html")],
  ["/targets/jwt-lab/dast/index.html", playgroundFileResponse("targets/jwt-lab/dast/index.html")],
  ["/assets/vendor/jquery/jquery-3.4.1.min.js", playgroundFileResponse("assets/vendor/jquery/jquery-3.4.1.min.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/assets/vendor/jquery/jquery-3.7.1.min.js", playgroundFileResponse("assets/vendor/jquery/jquery-3.7.1.min.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/passive/header_disclosure_canary.html", fileResponse("header_disclosure_canary.html")],
  ["/passive/assets/header-disclosure-canary.js", fileResponse("header_disclosure_canary.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/session-bound-order-search/order-search.js", playgroundFileResponse("targets/session-bound-order-search/order-search.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/targets/session-bound-order-search/vulnerable/", playgroundFileResponse("targets/session-bound-order-search/index.html", { headers: orderSearchPageHeaders })],
  ["/targets/session-bound-order-search/vulnerable/index.html", playgroundFileResponse("targets/session-bound-order-search/index.html", { headers: orderSearchPageHeaders })],
  ["/targets/session-bound-order-search/fixed/", playgroundFileResponse("targets/session-bound-order-search/index.html", { headers: orderSearchPageHeaders })],
  ["/targets/session-bound-order-search/fixed/index.html", playgroundFileResponse("targets/session-bound-order-search/index.html", { headers: orderSearchPageHeaders })],

  ["/passive/cases/headers/powered-by.html", fileResponse("header_disclosure_canary.html", {
    headers: {
      ...secureHeaderCanaryHeaders,
      "X-Powered-By": "PTK Header Canary"
    }
  })],
  ["/passive/cases/headers/secure-control.html", fileResponse("header_disclosure_canary.html", {
    headers: secureHeaderCanaryHeaders
  })],

  ["/passive/fixtures/headers/weak-security.html", fileResponse("headers_weak_security.html", {
    headers: (isHttps) => ({
      "Content-Security-Policy": "script-src 'unsafe-inline' 'unsafe-eval' *; style-src *; connect-src https://telemetry.example.net https://logs.example.net",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Cross-Origin-Embedder-Policy": "unsafe-none",
      "Permissions-Policy": "geolocation=*, vibrate=*",
      "Referrer-Policy": "unsafe-url",
      "Clear-Site-Data": "\"*\"",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH",
      "Access-Control-Allow-Headers": "Authorization, X-Api-Key, X-Requested-With",
      "Access-Control-Expose-Headers": "Authorization, X-Auth, X-Access-Token",
      "Access-Control-Allow-Private-Network": "true",
      "X-Powered-By": "Express 5.0.0-beta",
      "Server": "nginx/1.27.0",
      "X-XSS-Protection": "1; mode=block",
      "Expect-CT": "max-age=86400",
      "Public-Key-Pins": "pin-sha256=\"abc\"; max-age=5184000",
      "Set-Cookie": "session=ptk_session_demo; Path=/; HttpOnly",
      "Cache-Control": "public, max-age=600",
      ...(isHttps ? {} : {})
    })
  })],
  ["/passive/fixtures/headers/secure-control.html", fileResponse("headers_weak_security.html", {
    headers: secureHeaderCanaryHeaders
  })],
  ["/passive/fixtures/headers/hsts-over-http.html", fileResponse("headers_weak_security.html", {
    headers: {
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
    }
  })],
  ["/passive/fixtures/headers/report-only.html", fileResponse("headers_weak_security.html", {
    headers: {
      "Content-Security-Policy-Report-Only": "default-src *; report-uri https://reports.example.net/csp"
    }
  })],

  ["/passive/fixtures/errors/stacktraces.html", fileResponse("stacktrace_env_hints.html")],
  ["/passive/assets/client-config.js", fileResponse("client_secrets.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/passive/debug/source-map.html", fileResponse("sourcemap_debug.html")],
  ["/passive/assets/app.bundle.js", fileResponse("sourcemap_debug_bundle.js", { contentType: "application/javascript; charset=utf-8" })],
  ["/passive/assets/app.bundle.js.map", bodyResponse(JSON.stringify({
    version: 3,
    file: "app.bundle.js",
    sources: ["src/app.js"],
    names: [],
    mappings: "AAAA"
  }, null, 2), { contentType: "application/json; charset=utf-8" })],

  ["/passive/swagger-ui/index.html", fileResponse("api_docs_graphql.html")],
  ["/passive/graphiql", fileResponse("api_docs_graphql.html")],
  ["/passive/redoc", fileResponse("api_docs_graphql.html")],
  ["/passive/openapi.json", bodyResponse(JSON.stringify({
    openapi: "3.1.0",
    paths: {
      "/orders": { get: { operationId: "listOrders" } }
    }
  }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/passive/openapi.yaml", bodyResponse("openapi: 3.1.0\npaths:\n  /orders:\n    get:\n      operationId: listOrders\n", { contentType: "application/yaml; charset=utf-8" })],
  ["/passive/postman.collection.json", bodyResponse(JSON.stringify({
    info: {
      _postman_id: "ptk-passive-demo",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: []
  }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/passive/graphql", bodyResponse(JSON.stringify({
    operationName: "ListOrders",
    query: "query ListOrders { orders { id total } }",
    extensions: {
      persistedQuery: {
        sha256Hash: "0123456789abcdef"
      }
    },
    errors: [
      { message: "Cannot query field \"dangerouslyVerboseField\" on type \"Query\"." }
    ]
  }, null, 2), { contentType: "application/json; charset=utf-8" })],

  ["/.well-known/security.txt", bodyResponse("Contact: mailto:security@example.test\nAcknowledgments: https://example.test/hall-of-fame\n", { contentType: "text/plain; charset=utf-8" })],
  ["/.well-known/openid-configuration", bodyResponse(JSON.stringify({
    issuer: "https://localhost:3443",
    authorization_endpoint: "https://localhost:3443/authorize",
    jwks_uri: "https://localhost:3443/.well-known/jwks.json"
  }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/.well-known/assetlinks.json", bodyResponse(JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"] }], null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/apple-app-site-association", bodyResponse(JSON.stringify({ applinks: { apps: [], details: [] } }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/.well-known/oauth-authorization-server", bodyResponse(JSON.stringify({ issuer: "https://localhost:3443" }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/.well-known/jwks.json", bodyResponse(JSON.stringify({ keys: [] }, null, 2), { contentType: "application/json; charset=utf-8" })],
  ["/.well-known/change-password", bodyResponse("Change password helper", { contentType: "text/plain; charset=utf-8" })],
  ["/robots.txt", bodyResponse("User-agent: *\nDisallow: /admin\n", { contentType: "text/plain; charset=utf-8" })],
  ["/humans.txt", bodyResponse("PTK Passive Fixture Team\n", { contentType: "text/plain; charset=utf-8" })],

  ["/passive/fixtures/data/sensitive-data.html", fileResponse("sensitive_data.html")],
  ["/passive/fixtures/deser/indicator.html", fileResponse("deserialization_indicator.html")],
  ["/passive/fixtures/tokens/index.html", fileResponse("token_param_surfaces.html")],
  ["/passive/fixtures/tokens/url-leaks.html", fileResponse("token_param_surfaces.html")],
  ["/passive/fixtures/tokens/jwt-url.html", fileResponse("token_param_surfaces.html")],
  ["/passive/fixtures/params/high-risk.html", fileResponse("token_param_surfaces.html")],

  ["/passive/checkout/payment.html", fileResponse("workflow_surfaces.html")],
  ["/support/tickets/create", fileResponse("workflow_surfaces.html")],
  ["/login", fileResponse("workflow_surfaces.html", { headers: { "Set-Cookie": "session=ptk_auth; Path=/; HttpOnly" } })],
  ["/register", fileResponse("workflow_surfaces.html")],
  ["/password/reset", fileResponse("workflow_surfaces.html")],
  ["/logout", fileResponse("workflow_surfaces.html")],
  ["/mfa/verify", fileResponse("workflow_surfaces.html")],
  ["/impersonate", fileResponse("workflow_surfaces.html")],
  ["/signin-oidc", fileResponse("workflow_surfaces.html")],

  ["/orgs/acme/workspaces/red-team/settings.html", fileResponse("tenant_boundary.html", {
    headers: {
      "X-Tenant-Id": "tenant_acme",
      "Set-Cookie": "tenantId=tenant_acme; Path=/; HttpOnly"
    }
  })],
  ["/switch-tenant", fileResponse("tenant_boundary.html")],

  ["/passive/realtime/overview.html", fileResponse("realtime_surfaces.html")],
  ["/passive/realtime/events", bodyResponse("event: ready\ndata: passive-sse\n\n", { contentType: "text/event-stream; charset=utf-8", headers: { "Cache-Control": "no-cache" } })],
  ["/sockjs/echo", fileResponse("realtime_surfaces.html")],
  ["/socket.io/", fileResponse("realtime_surfaces.html")],

  ["/wp-admin/index.html", fileResponse("framework_surface.html")],
  ["/drupal/core/install.php", fileResponse("framework_surface.html")],
  ["/dwr/engine.js", fileResponse("framework_surface.html", { contentType: "application/javascript; charset=utf-8" })],
  ["/grafana/", fileResponse("framework_surface.html")],
  ["/actuator", fileResponse("framework_surface.html")],
  ["/phpinfo.php", fileResponse("framework_surface.html")],
  ["/.git/config", fileResponse("framework_surface.html", { contentType: "text/plain; charset=utf-8" })],
  ["/sidekiq", fileResponse("framework_surface.html")],
  ["/phpmyadmin", fileResponse("framework_surface.html")],

  ["/passive/upload/index.html", fileResponse("file_transfer_surface.html")],
  ["/passive/downloads/report.csv", bodyResponse("id,total\nord_1,149.99\n", {
    contentType: "text/csv; charset=utf-8",
    headers: {
      "Content-Disposition": "attachment; filename=\"report.csv\"",
      "Cache-Control": "public, max-age=300",
      "Set-Cookie": "download_session=ptk; Path=/"
    }
  })],
  ["/passive/files/data.dump", bodyResponse("PTK_ARCHIVE\n", { contentType: "application/octet-stream" })],
]);

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "text/html; charset=utf-8";
}

function toHeaders(rawHeaders, isHttps) {
  const resolved = typeof rawHeaders === "function" ? rawHeaders(isHttps) : (rawHeaders || {});
  return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
}

function send(res, statusCode, body, contentType, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": payload.length,
    ...headers
  });
  res.end(payload);
}

function serveRoute(req, res, { pathname, isHttps }) {
  let route = routeMap.get(pathname);
  if (!route && pathname.startsWith("/atomic/")) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      send(res, 400, "Invalid fixture route", "text/plain; charset=utf-8");
      return;
    }
    const normalized = path.posix.normalize(decodedPath);
    if (normalized.startsWith("/atomic/") && !normalized.includes("/../")) {
      const relative = normalized.replace(/^\//, "") + (normalized.endsWith("/") ? "index.html" : "");
      const candidate = path.resolve(playgroundRoot, relative);
      if (candidate.startsWith(`${path.resolve(playgroundRoot, "atomic")}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        route = playgroundFileResponse(relative);
      }
    }
  }
  if (!route) {
    send(res, 404, "Passive fixture route not found", "text/plain; charset=utf-8");
    return;
  }

  const headers = toHeaders(route.headers, isHttps);
  if (route.file) {
    const filePath = path.join(route.root || passiveRoot, route.file);
    if (!fs.existsSync(filePath)) {
      send(res, 500, `Missing passive fixture file: ${route.file}`, "text/plain; charset=utf-8");
      return;
    }
    const body = fs.readFileSync(filePath);
    send(res, route.statusCode || 200, body, route.contentType || contentTypeFor(filePath), headers);
    return;
  }
  send(res, route.statusCode || 200, route.body || "", route.contentType || "text/html; charset=utf-8", headers);
}

function readBoundedBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) {
        const error = new Error("request_body_too_large");
        error.code = "request_body_too_large";
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function jsonResponse(res, statusCode, value, headers = {}) {
  send(res, statusCode, JSON.stringify(value), "application/json; charset=utf-8", {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
}

async function serveOrderSearchApi(req, res, { pathname, isHttps }) {
  if (!isHttps) {
    jsonResponse(res, 426, { ok: false, code: "HTTPS_REQUIRED" });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    jsonResponse(res, 415, { ok: false, code: "FORM_ENCODING_REQUIRED" });
    return;
  }
  if (!String(req.headers.cookie || "").split(/;\s*/).includes("ptk_order_session=active")) {
    jsonResponse(res, 401, { ok: false, code: "SESSION_REQUIRED" });
    return;
  }
  if (req.headers["x-playground-request"] !== "order-search") {
    jsonResponse(res, 400, { ok: false, code: "REQUEST_CONTEXT_REQUIRED" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readBoundedBody(req);
  } catch (error) {
    if (error?.code === "request_body_too_large") {
      jsonResponse(res, 413, { ok: false, code: "REQUEST_BODY_TOO_LARGE" });
      return;
    }
    jsonResponse(res, 400, { ok: false, code: "REQUEST_BODY_INVALID" });
    return;
  }
  const body = new URLSearchParams(rawBody);
  const query = String(body.get("query") || "");
  if (!query || query.length > 256) {
    jsonResponse(res, 400, { ok: false, code: "QUERY_INVALID" });
    return;
  }

  const reviewTarget = pathname.includes("/vulnerable/");
  if (reviewTarget && /['"]/.test(query)) {
    jsonResponse(res, 500, {
      ok: false,
      code: "ORDER_QUERY_SYNTAX",
      message: "You have an error in your SQL syntax near the order search value"
    });
    return;
  }
  jsonResponse(res, 200, {
    ok: true,
    count: query === "wireless headphones" ? 1 : 0,
    message: query === "wireless headphones" ? "One matching order" : "No matching orders"
  });
}

async function serveHistoryOrderApi(req, res, { pathname }) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    jsonResponse(res, 415, { ok: false, code: "JSON_REQUIRED" });
    return;
  }
  if (!String(req.headers.cookie || "").split(/;\s*/).includes("ptk_history_order_session=active")) {
    jsonResponse(res, 401, { ok: false, code: "SESSION_REQUIRED" });
    return;
  }
  if (req.headers["x-playground-request"] !== "history-order-router") {
    jsonResponse(res, 400, { ok: false, code: "REQUEST_CONTEXT_REQUIRED" });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBoundedBody(req, 2048));
  } catch (error) {
    const statusCode = error?.code === "request_body_too_large" ? 413 : 400;
    jsonResponse(res, statusCode, {
      ok: false,
      code: statusCode === 413 ? "REQUEST_BODY_TOO_LARGE" : "JSON_INVALID"
    });
    return;
  }
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  if (!orderId || orderId.length > 128) {
    jsonResponse(res, 400, { ok: false, code: "ORDER_ID_INVALID" });
    return;
  }

  const reviewTarget = pathname.includes("/vulnerable/");
  if (reviewTarget && /['"]/.test(orderId)) {
    jsonResponse(res, 500, {
      ok: false,
      code: "ORDER_LOOKUP_SYNTAX",
      message: "SQL syntax error near the supplied order identifier"
    });
    return;
  }
  if (!/^order-\d{1,8}$/.test(orderId)) {
    jsonResponse(res, 400, { ok: false, code: "ORDER_ID_FORMAT_REJECTED" });
    return;
  }
  jsonResponse(res, 200, {
    ok: true,
    orderId,
    message: "Order 4815 loaded from the authenticated API."
  });
}

const JWT_LAB_SIGNED_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdGstcGxheWdyb3VuZCIsInNjb3BlIjoiZGVtbyJ9.synthetic-signature";

function decodeJwtLabHeader(segment) {
  try {
    if (!segment || String(segment).length > 2048) return null;
    const decoded = Buffer.from(String(segment), "base64url").toString("utf8");
    const value = JSON.parse(decoded);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseJwtLabToken(value) {
  const text = String(value || "");
  if (!text || text.length > 4096) return null;
  const match = text.match(/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)/);
  if (!match) return null;
  const header = decodeJwtLabHeader(match[1]);
  if (!header) return null;
  return { token: match[0], header, payload: match[2], signature: match[3] };
}

function jwtLabCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(/;\s*/)) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1);
  }
  return "";
}

async function jwtLabCarrierToken(req, carrier) {
  if (carrier === "authorization") {
    return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  }
  if (carrier === "cookie") return jwtLabCookie(req, "ptk_jwt_lab_session");
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const rawBody = await readBoundedBody(req, 4096);
  if (carrier === "form") {
    if (!contentType.startsWith("application/x-www-form-urlencoded")) return "";
    return String(new URLSearchParams(rawBody).get("access_token") || "");
  }
  if (carrier === "json") {
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/.test(contentType)) return "";
    try {
      const body = JSON.parse(rawBody);
      return typeof body?.auth?.access_token === "string" ? body.auth.access_token : "";
    } catch {
      return "";
    }
  }
  return "";
}

function jwtLabDecision(parsed, vulnerable) {
  if (!parsed) return { status: 401, code: "JWT_REQUIRED", message: "A valid synthetic token is required." };
  const alg = String(parsed.header.alg || "").toLowerCase();
  const kid = String(parsed.header.kid || "");
  const jku = String(parsed.header.jku || "");
  if (parsed.token === JWT_LAB_SIGNED_TOKEN) {
    return { status: 200, code: "JWT_ACCEPTED", message: "Synthetic JWT accepted for the demo account." };
  }
  if (vulnerable && alg === "none" && parsed.signature === "") {
    return { status: 200, code: "JWT_ACCEPTED", message: "Synthetic JWT accepted for the demo account." };
  }
  if (vulnerable && alg === "hs256" && parsed.signature === "" && !kid && !jku) {
    return { status: 200, code: "JWT_ACCEPTED", message: "Synthetic JWT accepted for the demo account." };
  }
  if (vulnerable && /(?:\.\.[/\\]|^[/\\]|[/\\]dev[/\\]null)/i.test(kid)) {
    return { status: 400, code: "JWT_KID_PATH", message: "Unsafe kid path traversal reached the simulated key resolver; no file was read." };
  }
  if (vulnerable && /^https?:\/\//i.test(jku)) {
    return { status: 400, code: "JWT_REMOTE_KEY", message: "Untrusted jku remote key metadata reached the simulated resolver; no network request was made." };
  }
  return { status: 401, code: "JWT_REJECTED", message: "JWT signature or verification policy rejected the token." };
}

async function serveJwtLabApi(req, res, { pathname }) {
  const match = pathname.match(/^\/targets\/jwt-lab\/(authorization|cookie|form|json)\/(vulnerable|fixed)\/api\/(seed|session)$/);
  if (!match) {
    jsonResponse(res, 404, { ok: false, code: "JWT_LAB_ROUTE_NOT_FOUND" });
    return;
  }
  const [, carrier, variant, operation] = match;
  if (req.headers["x-playground-request"] !== "jwt-lab") {
    jsonResponse(res, 400, { ok: false, code: "REQUEST_CONTEXT_REQUIRED" });
    return;
  }
  if (operation === "seed") {
    if (carrier !== "cookie" || req.method !== "GET") {
      res.setHeader("Allow", carrier === "cookie" ? "GET" : "POST");
      jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return;
    }
    const cookiePath = `/targets/jwt-lab/cookie/${variant}/`;
    jsonResponse(res, 200, { ok: true, code: "COOKIE_SEEDED" }, {
      "Set-Cookie": `ptk_jwt_lab_session=${JWT_LAB_SIGNED_TOKEN}; Path=${cookiePath}; HttpOnly; SameSite=Lax`
    });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  let token;
  try {
    token = await jwtLabCarrierToken(req, carrier);
  } catch (error) {
    jsonResponse(res, error?.code === "request_body_too_large" ? 413 : 400, {
      ok: false,
      code: error?.code === "request_body_too_large" ? "REQUEST_BODY_TOO_LARGE" : "REQUEST_BODY_INVALID"
    });
    return;
  }
  const decision = jwtLabDecision(parseJwtLabToken(token), variant === "vulnerable");
  jsonResponse(res, decision.status, {
    ok: decision.status >= 200 && decision.status < 300,
    code: decision.code,
    message: decision.message,
    carrier
  });
}

function serveChildContextApi(req, res, { pathname }) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }
  if (!String(req.headers.cookie || "").split(/;\s*/).includes("ptk_child_context_session=active")) {
    jsonResponse(res, 401, { ok: false, code: "SESSION_REQUIRED" });
    return;
  }
  if (req.headers["x-playground-request"] !== "child-context") {
    jsonResponse(res, 400, { ok: false, code: "REQUEST_CONTEXT_REQUIRED" });
    return;
  }
  const reviewTarget = pathname.includes("/vulnerable/");
  jsonResponse(res, 200, {
    ok: true,
    message: "Child context loaded for the related browser session."
  }, reviewTarget ? { "X-Powered-By": "PTK Child Context Canary" } : {});
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${HTTP_PORT}`}`);
  if (!["/passive/realtime/ws", "/socket.io/", "/sockjs/echo"].includes(url.pathname)) {
    socket.destroy();
    return;
  }
  const websocketKey = req.headers["sec-websocket-key"];
  if (!websocketKey) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(`${websocketKey}${WS_GUID}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );
  socket.on("data", () => {});
}

function maybeCreateTlsContext() {
  const certDir = path.join(os.tmpdir(), "ptk-passive-fixtures-tls");
  const keyPath = path.join(certDir, "localhost.key");
  const certPath = path.join(certDir, "localhost.crt");
  try {
    fs.mkdirSync(certDir, { recursive: true });
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      execFileSync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "365",
        "-subj",
        "/CN=localhost"
      ], { stdio: "ignore" });
    }
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (error) {
    return null;
  }
}

function createRequestHandler(isHttps) {
  return async (req, res) => {
    const url = new URL(req.url, `${isHttps ? "https" : "http"}://${req.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        jsonResponse(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
        return;
      }
      jsonResponse(res, 200, {
        ok: true,
        service: "owasp-ptk-playground",
        mode: "route-aware",
        protocol: isHttps ? "https" : "http",
        httpsAvailable: Boolean(tlsContext),
        routes: {
          demo: "/demo/",
          scanner: "/scanner/",
          catalogue: "/catalog/scanner-targets.json"
        }
      });
      return;
    }
    if (await handleRealLabsApi(req, res, url.pathname)) return;
    if (serveReflectedXss(req, res, url)) return;
    if (serveAttributeXss(req, res, url)) return;
    if (await handleWorkshopLabApi(req, res, url.pathname)) return;
    if (/^\/targets\/session-bound-order-search\/(?:vulnerable|fixed)\/api\/search$/.test(url.pathname)) {
      await serveOrderSearchApi(req, res, { pathname: url.pathname, isHttps });
      return;
    }
    if (/^\/targets\/history-order-router\/(?:vulnerable|fixed)\/api\/order$/.test(url.pathname)) {
      await serveHistoryOrderApi(req, res, { pathname: url.pathname });
      return;
    }
    if (/^\/targets\/same-origin-child-tab\/(?:vulnerable|fixed)\/api\/context$/.test(url.pathname)) {
      serveChildContextApi(req, res, { pathname: url.pathname });
      return;
    }
    if (/^\/targets\/jwt-lab\/(?:authorization|cookie|form|json)\/(?:vulnerable|fixed)\/api\/(?:seed|session)$/.test(url.pathname)) {
      await serveJwtLabApi(req, res, { pathname: url.pathname });
      return;
    }
    serveRoute(req, res, { pathname: url.pathname, isHttps });
  };
}

const tlsContext = maybeCreateTlsContext();
const httpServer = http.createServer(createRequestHandler(false));
httpServer.on("upgrade", handleUpgrade);
httpServer.listen(HTTP_PORT, LISTEN_HOST, () => {
  console.log(`[passive-fixtures] HTTP ready on http://${DISPLAY_HOST}:${HTTP_PORT}/passive/`);
});

if (tlsContext) {
  const httpsServer = https.createServer(tlsContext, createRequestHandler(true));
  httpsServer.on("upgrade", handleUpgrade);
  httpsServer.listen(HTTPS_PORT, LISTEN_HOST, () => {
    console.log(`[passive-fixtures] HTTPS ready on https://${DISPLAY_HOST}:${HTTPS_PORT}/passive/`);
  });
} else {
  console.log("[passive-fixtures] HTTPS disabled: openssl not available for local certificate generation");
}
