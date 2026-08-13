# OWASP PTK Playground

Deliberately vulnerable browser fixtures for learning and validating
[OWASP Penetration Testing Kit](https://owasp.org/www-project-penetration-testing-kit/).

The playground combines realistic browser-security campaigns with focused
client-side SAST, in-browser IAST and passive DAST fixtures. Campaign missions
can also load pinned local dependencies for SCA. It supports four workflows:

- **Campaign** — progressive Discover, Prove and Fix objectives.
- **Explorer** — every objective, hint, target and source without unlocks.
- **Demo** — one curated 12-minute journey across all four evidence families.
- **Scanner** — direct state-free targets and neutral machine-readable metadata.

Use these fixtures only in an environment you own or are authorised to test.

## PTK Pro preview

The home and campaign pages include a separate **PTK Pro — Coming soon**
roadmap lane. It highlights selected public scenarios being used to validate
additional future coverage. The preview is presentation metadata only: PTK Pro
scanning is not enabled on this site, the current 12-minute demo uses published
PTK capabilities, and every target remains open and scanner-neutral.

Only a high-level status and planned engine are public. Scanner metadata and
direct target files contain no product-tier data, private rule identities,
payloads, detection logic, expected findings, access policy or credentials.

## Open the playground

The public catalogue is available at:

<https://ptklabs.github.io/ptk-playground/>

SAST and IAST pages can also be served locally with any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

For a scanner-neutral directory of all review/repaired target pairs, open:

<http://localhost:8000/scanner/>

The static page enables static targets and leaves protocol-dependent targets
disabled. Its minimal machine-readable catalogue is available at
`catalog/scanner-targets.json`; it contains routes and runtime requirements,
not gameplay answers, scanner rules, payloads or expected findings.

For the curated presenter journey, open:

<http://localhost:8000/demo/>

It connects the Support Widget, Session-Bound Order Search, and Transient Route
Notice missions into three chapters covering SCA, SAST, IAST, and DAST. Static
hosting enables chapters 1 and 3. Open
<http://127.0.0.1:3080/demo/> through the route-aware server to enable all six
review/repaired target links, including the authenticated chapter.

The first browser-code campaign is available at:

<http://localhost:8000/campaigns/support-widget/>

Its scanner targets work directly, without campaign progress:

- <http://localhost:8000/targets/support-widget/vulnerable/>
- <http://localhost:8000/targets/support-widget/fixed/>

The response-boundary campaign requires the route-aware server described
below. Once it is running, open:

<http://localhost:3080/campaigns/deployment-response-boundary/>

Its paired scanner targets are served over local HTTPS:

- <https://localhost:3443/passive/cases/headers/powered-by.html>
- <https://localhost:3443/passive/cases/headers/secure-control.html>

The session-bound active DAST campaign uses the same route-aware server:

<http://localhost:3080/campaigns/session-bound-order-search/>

Opening either target establishes a scoped HTTP-only session. Submitting the
form creates the same-origin, form-encoded POST request used by the mission:

- <https://localhost:3443/targets/session-bound-order-search/vulnerable/>
- <https://localhost:3443/targets/session-bound-order-search/fixed/>

The on-demand SCA campaign runs on static hosting. Its direct targets request
no component during the initial load; press the workspace button to load the
review or repaired dependency:

- <http://localhost:8000/campaigns/on-demand-analytics/>
- <http://localhost:8000/targets/on-demand-analytics/vulnerable/>
- <http://localhost:8000/targets/on-demand-analytics/fixed/>

The saved-workspace campaign demonstrates browser state crossing a real
same-origin navigation. Each setup route saves a harmless announcement before
opening its child dashboard document:

- <http://localhost:8000/campaigns/saved-workspace/>
- <http://localhost:8000/targets/saved-workspace/vulnerable/>
- <http://localhost:8000/targets/saved-workspace/fixed/>

The review dashboard interprets the restored value as markup; the repaired
dashboard preserves the storage and navigation journey while rendering the
same bytes as text.

The live-profile-preview campaign demonstrates an API field that is absent
from initial page traffic and reaches the DOM only after a browser action:

- <http://localhost:8000/campaigns/live-profile-preview/>
- <http://localhost:8000/targets/live-profile-preview/vulnerable/>
- <http://localhost:8000/targets/live-profile-preview/fixed/>

Both targets request the same local JSON response. The review target
interprets its harmless markup-shaped summary; the repaired target displays
the same response bytes as text.

The transient-route-notice campaign demonstrates a client-side deep link whose
DOM evidence exists for only 30 ms after an in-document hash-route change:

- <http://localhost:8000/campaigns/transient-route-notice/>
- <http://localhost:8000/targets/transient-route-notice/vulnerable/>
- <http://localhost:8000/targets/transient-route-notice/fixed/>

Both targets use the same action, hash-query parameter and expiry boundary. The
review route interprets the prepared value as markup; the repaired route maps
only the accepted value to constant text and rejects arbitrary input.

The imported-request-preferences campaign demonstrates how user-controlled
JSON can change a browser request through an inherited object property:

- <http://localhost:8000/campaigns/imported-request-preferences/>
- <http://localhost:8000/targets/imported-request-preferences/vulnerable/>
- <http://localhost:8000/targets/imported-request-preferences/fixed/>

Both targets parse the same prepared document and request the same local JSON
preview. The review route performs an unsafe merge; the repaired route uses a
null-prototype options object and copies only accepted own properties.

## Run passive DAST fixtures

Passive checks depend on real response headers, exact routes, MIME types,
cookies, downloads, SSE, WebSocket upgrades and HTTPS context. GitHub Pages can
show the catalogue, but it cannot reproduce those server behaviours.

Start the dedicated route-aware server from the repository root:

```bash
npm run demo
```

Default pages:

- <http://localhost:3080/passive/>
- <http://localhost:3080/scanner/>
- <http://localhost:3080/demo/>
- <http://localhost:3080/campaigns/deployment-response-boundary/>
- <http://localhost:3080/campaigns/session-bound-order-search/>
- <https://localhost:3443/passive/> when OpenSSL is available

The HTTPS endpoint uses a local self-signed certificate intended only for this
fixture environment.

The server binds to `127.0.0.1` by default so the deliberately vulnerable
fixtures are not exposed to the local network. The ports can be changed with
`PTK_PASSIVE_HTTP_PORT` and `PTK_PASSIVE_HTTPS_PORT` when required.

Before a workshop or presentation, run the isolated readiness check:

```bash
npm run demo:preflight
```

The preflight starts a temporary loopback-only runtime on unused ports and
checks the health contract, curated demo and scanner catalogues, local-only
target routes, HTTPS availability, scoped session cookie, and the exact
session-bound DAST review/control response pair. It stops its temporary server
when complete.

The route-aware runtime exposes a machine-readable readiness response at
`/healthz`. A successful response identifies the service and reports whether
the local HTTPS listener is available.

Campaign and presenter progress is stored only in namespaced session storage.
Use the visible **Reset** control on the current mission or demo page before a
presentation. The Saved Workspace targets have their own **Clear saved
announcement** action; review and repaired values use separate keys. These
controls reset playground-owned state without clearing unrelated browser data.

## Understand the engines

### SAST

SAST analyses collected client-side code without requiring the vulnerable path
to execute. A broad SAST lab can therefore produce findings for multiple code
paths even when only one control is clicked.

### IAST

IAST observes source-to-sink behaviour while browser code executes. Most IAST
cases require a declared setup and trigger before the expected finding can be
reported.

### Passive DAST

Passive DAST analyses browser-visible requests, responses and attack-surface
signals without mutating the target. The local server provides the exact
protocol behaviour required by these cases.

### Active DAST

Active DAST replays and mutates browser-observed requests within an authorised
scope. The session-bound order-search mission supplies a bounded POST API,
scoped cookie and paired repaired route so a scanner can prove both a positive
finding and its absence without attacking an external application.

### SCA

SCA observes the JavaScript dependencies loaded by the browser. Campaign
dependencies are pinned locally with source, licence and SHA-256 metadata so a
vulnerable version and its repaired comparison remain deterministic.
The on-demand analytics mission also demonstrates why the user journey
matters: its dependency is absent from initial page traffic and appears only
after a browser action.

### Cross-navigation browser state

The saved-workspace mission connects static and runtime analysis across two
documents. The setup page persists application state, then a child dashboard
reads that origin-scoped value and writes it to the DOM. The paired control
keeps the same storage and navigation behavior while changing only the DOM
write from markup interpretation to text rendering.

### Action-loaded response fields

The live-profile-preview mission connects browser traffic, static source and
runtime reachability. The profile response does not exist in initial traffic;
the user action fetches one same-origin JSON document and passes a parsed field
to paired DOM operations.

### Transient SPA route state

The transient-route-notice mission changes a hash-query route without a page
reload and removes the rendered notice after 30 ms. It provides paired static,
runtime and active-browser targets for scanners that can observe an application
transition rather than relying only on the initial response or a late snapshot.

### Imported client configuration

The imported-request-preferences mission connects a static configuration-merge
path with its live browser impact. It distinguishes an object's own request
keys from values inherited through its prototype, while the repaired control
keeps the import and preview request but accepts only reviewed own properties.

## Public fixture boundary

The playground contains generic browser behaviours, not PTK rule definitions,
payload catalogues, matchers, policies or execution logic. PTK-specific mapping
and expected-result assertions are maintained in the separate test harness.

Credential-looking strings in secret-detection fixtures are synthetic,
non-functional test values. They do not grant access to any real account,
service or system.

## Repository structure

```text
ptk-playground/
├── index.html              Playground home
├── catalog/cases.json      Public, non-executable case catalogue
├── catalog/missions.json   Campaign and objective metadata
├── catalog/demo.json       Curated, scanner-neutral demo metadata
├── catalog/scanner-targets.json
│                           Minimal scanner-neutral target metadata
├── campaigns/              Guided, explorer, demo and scanner shells
├── demo/                   Curated cross-engine presenter journey
├── scanner/                Filterable scanner quick start
├── targets/                Direct state-free mission targets
├── assets/                 Shared self-hosted UI assets
├── sast/                   Client-side static-analysis fixtures
├── iast/                   Runtime source-to-sink fixtures
├── passive/                Route-aware passive DAST fixtures and server
└── test/                   Structural and public-boundary tests
```

PTK-specific module IDs, exact finding assertions and automation orchestration
are maintained outside this public fixture repository.

## Validate structural contracts

The structural suite checks catalogue and mission validity, static and
route-aware local targets,
target/game isolation, vendored dependency provenance, duplicate element IDs,
self-hosted playground assets and the public rulepack boundary:

```bash
node --test test/playground.structure.test.mjs
```

The public browser tests cover the static campaign shell, the scanner target
directory, the paired response-metadata mission, the session-bound
active-request mission and the action-loaded dependency mission:

```bash
node --test test/playground.browser-smoke.mjs
node --test test/scanner-directory.browser.test.mjs
node --test test/deployment-response.browser.test.mjs
node --test test/session-bound-order-search.browser.test.mjs
node --test test/on-demand-analytics.browser.test.mjs
node --test test/saved-workspace.browser.test.mjs
node --test test/live-profile-preview.browser.test.mjs
node --test test/transient-route-notice.browser.test.mjs
node --test test/imported-request-preferences.browser.test.mjs
node --test test/demo-journey.browser.test.mjs
```

Some legacy SAST fixtures intentionally use a bounded list of remote jQuery or
Underscore dependencies. The structural test freezes that list so it cannot
grow silently; replacing those dependencies with reviewed local copies is a
separate fixture-compatibility task.

## Add a fixture

1. Choose a campaign mission or a focused SAST, IAST or passive DAST fixture.
2. Prefer one vulnerable behaviour and one clear safe control per deterministic
   case.
3. Keep state, cookies and storage keys scoped to the case.
4. Keep navigation and requests inside the authorised fixture origin.
5. Add neutral public metadata to `catalog/cases.json`.
6. For a paired mission target, update `catalog/missions.json` and its exact
   minimal projection in `catalog/scanner-targets.json`.
7. Run the structural tests.
8. When the fixture is used by PTK regression automation, update the maintained
   internal coverage manifest and expected finding contract separately.

Do not add extension-private APIs, credentials, scan policies or executable
rule definitions to this repository.

## Project links

- [OWASP PTK project](https://owasp.org/www-project-penetration-testing-kit/)
- [OWASP PTK source and pentester guide](https://github.com/DenisPodgurskii/pentestkit)
- [PTK Agent](https://github.com/ptklabs/ptk-agent)
- [PTK Agent on npm](https://www.npmjs.com/package/pentestkit)

## Licence

This repository is licensed under the [MIT License](LICENSE).
