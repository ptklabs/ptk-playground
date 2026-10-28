# OWASP PTK Playground

A deliberately vulnerable browser-security playground for learning,
demonstrating and validating
[OWASP Penetration Testing Kit](https://owasp.org/www-project-penetration-testing-kit/).

The playground connects client-side SAST, in-browser IAST, SCA, passive DAST
and active DAST to browser behaviours that can be seen and reproduced. It is
scanner-neutral: direct targets do not call PTK APIs and can be used by other
authorised security tools.

Use these fixtures only in an environment you own or are authorised to test.

## Open the playground

Public site: <https://ptklabs.github.io/ptk-playground/>

The site has three entry points:

- **Play** — choose a short path, then use the linked mission's objectives,
  hints and visible proof tokens or open every target directly.
- **Explore** — search the complete catalogue of focused cases and retained
  historical labs.
- **Labs** — choose a JWT, XSS, SQL, browser-context or access-control category,
  then open an individual vulnerable/repaired case.

The guided BSides journey is available at:

<https://ptklabs.github.io/ptk-playground/play/?playlist=browser-context-demo>

Playlists are views over the full catalogue. They do not define or limit the
playground's coverage. The three-case browser-context path remains the fastest
conference demo; six additional paths cover all current missions,
static-to-runtime evidence, state and child documents, browser-provided DAST
traffic, dependency timing, and a three-mission SPA Deep Dive.

The SPA Deep Dive combines a History API route with an authenticated JSON
request, a dynamically imported route module with a late-loaded dependency,
and a causally related same-origin child tab. Use:

<https://ptklabs.github.io/ptk-playground/play/?playlist=spa-deep-dive>

Static hosting demonstrates the SAST, IAST and SCA boundaries. Run the local
route-aware server for the session APIs, response metadata, and explicit
alternate-host scope control.

## JWT Lab

Open `/jwt/` to follow a synthetic token through browser storage and four HTTP
request carriers. The storage review/control pair works on GitHub Pages and is
useful for JWT discovery demonstrations. Authorization headers, HttpOnly
cookies, form fields and nested JSON bodies require the local route-aware
runtime because static hosting cannot implement request/response behavior.

The active JWT fixtures are deliberately bounded. They use synthetic tokens,
never read local files for `kid` values, and never fetch remote `jku` URLs. Each
review endpoint has a paired fixed endpoint so scanners can prove both the
positive result and the negative control. Some case cards may describe future
coverage, but the playground contains no private rule definitions or attack
payload catalogue.

## Workshop labs

Open `/labs/` on the loopback runtime to choose a category, then an individual case.
Dedicated category pages are `/labs/jwt/`, `/labs/xss/`, `/labs/sql/`,
`/labs/browser-context/` and `/labs/access-control/`; the older `/jwt/` and
`/labs/spa/` routes remain available.

Current cases include:

- **SPA** — the existing 30 ms transient-route notice and separate History API and lazy-module cases.
- **Access control** — separate read and update IDOR cases with synthetic Alice/Bob sessions. Use isolated browser contexts or profiles to keep the two cookie jars independent. Each case has a repaired ownership-check route.
- **GraphQL order** — a bounded, documented POST operation that lets Alice query Bob's order on the review route. The repaired route returns `data.order: null` and `FORBIDDEN` while Alice's own order still succeeds. This is a manual PTK request/response proof case, not a claimed automatic BOLA finding; it has no introspection or arbitrary GraphQL operation support.
- **XSS** — stored XSS across Alice's author session and Bob's viewer session, with a text-rendering control, alongside existing DOM cases.
- **JWT** — the existing discovery and carrier cases plus a weak-HS256 token carried in the nested `auth.access_token` property of a JSON POST. A normal user token receives 403; a correctly forged admin token receives 200 only on the weak-key endpoint. The strong-key control rejects that same forgery.
- **Focused JWT verification** — `/labs/jwt-none/` compares an unsigned `alg:none` bearer token (review 200, repaired 401). `/labs/jwt-alg-confusion/` compares an HS256 admin token signed with published synthetic RSA public-key bytes. `/labs/jwt-null-signature/` keeps `alg:HS256` but empties the signature; `/labs/jwt-jwk-injection/` signs with a temporary attacker key and embeds only its public JWK. Each new forged admin token receives 200 on review and 401 on repaired; a normal user token receives 403 on both admin routes. These are target/browser contrasts and manual Full PTK proof candidates, not claimed automatic findings. Auto has not been qualified for them.
- **Actual SQL queries** — `/labs/sql-single-quote/`, `/labs/sql-double-quote/` and `/labs/sql-auth-bypass/` execute bounded in-memory SQLite SELECTs against synthetic rows. Their repaired controls bind values or allowlist the sort identifier. The older order-search syntax-error fixture remains available but is not a real injection proof.
- **XSS variants** — `/labs/xss-reflected/` and `/labs/xss-dom/` join the existing two-session stored case. Each new review target executes a harmless page-local marker; its repaired target displays the same input as text. The marker is browser proof, not by itself a PTK finding.

The session, stored-XSS and nested-JWT cases need `npm run demo` or the same
Docker runtime; static hosting cannot implement their APIs. Identity selection
is deliberately synthetic, not a real account system. All data remains local
and is reset when the process/container restarts. A signed-in lab session can
also call `POST /api/labs/reset` to clear orders and the saved message. Keep
the runtime bound to loopback; do not test these deliberately vulnerable cases
on an untrusted network. Fixture proof does not imply that PTK automatically
finds every case: distinguish a scanner finding from a manual request/runtime
proof during the workshop.

The focused JWT/SQL/XSS cases also require the local route-aware runtime. The
SQL engine is a pinned server-only dependency; it creates and closes a new
in-memory database for each request. No database file, real account, external
key lookup or unrestricted SQL endpoint is involved. Each focused lab page
states one action, vulnerable/repaired outcomes, reset and its current PTK
evidence tier. Until a pinned Full build proves a matching native finding, the
home and catalogue label these as candidate labs. Separate SAST/IAST-specific
cases and any advanced-rule detection claims need their own qualification.

## Why browser context matters

| Evidence | What the playground demonstrates |
|---|---|
| SAST | Client JavaScript and HTML paths, including code that has not executed |
| IAST | Live browser-controlled source-to-sink behaviour |
| Passive DAST | Browser-visible requests, responses, headers and attack surfaces |
| Active DAST | Bounded mutation of captured requests using real browser state |
| SCA | Dependencies that load initially or after an application action |

Focused challenges provide an isolated review target and a meaningful repaired
control. The current generated corpus separates 126 unique historical SAST
assertions and 149 historical IAST assertions into target-local review/control
source pairs. Broad SAST and IAST URLs are now family directories linking one
focused target per unique case. Historical combined pages remain available at
sibling `*.advanced.html` URLs for compatibility and research; they are not
counted as atomic coverage.

## Run locally

For static SAST, IAST, SCA and browser targets:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

Passive response behaviour and active DAST cases require exact headers,
cookies, methods, SSE/WebSocket upgrades or HTTPS. Start the loopback-only
route-aware runtime:

```bash
npm ci
npm run demo
```

Then open:

- <http://127.0.0.1:3080/play/>
- <http://127.0.0.1:3080/explore/>
- <http://127.0.0.1:3080/passive/>
- <http://127.0.0.1:3080/labs/>
- <https://127.0.0.1:3443/> when local HTTPS is available

The HTTPS listener uses a self-signed certificate intended only for this local
fixture environment. The server binds to `127.0.0.1` by default.

Before a workshop or presentation, run:

```bash
npm run demo:preflight
```

The preflight creates an isolated temporary runtime, checks its health and
positive/control contracts, and stops it on completion.

## Run the complete local demo with Docker

The Docker image runs the same route-aware Node runtime used by `npm run demo`.
It includes the local HTTPS listener and DAST request/response behavior; it is
not a generic static web-server image.

Build and start it with Docker Compose:

```bash
docker compose up --build
```

Then open:

- <http://127.0.0.1:3080/>;
- <http://127.0.0.1:3080/play/>;
- <http://127.0.0.1:3080/play/?playlist=spa-deep-dive>; or
- <https://127.0.0.1:3443/> for the local self-signed HTTPS fixtures.

The browser will warn about the intentionally self-signed local certificate.
Do not expose this deliberately vulnerable playground to an untrusted network.
Compose publishes both ports on host loopback only, runs the Node process as a
non-root user, drops Linux capabilities and keeps the container filesystem
read-only apart from temporary TLS material.

To validate a running container from the repository checkout:

```bash
npm run demo:container:smoke
```

This checks HTTP and HTTPS health, the SPA Deep Dive catalogue, and the
session-bound DAST positive/repaired contract. Stop and remove the local
container with:

```bash
docker compose down
```

The equivalent Docker CLI commands are:

```bash
docker build -t ptk-playground .
docker run --rm \
  --name ptk-playground \
  --init \
  --read-only \
  --tmpfs /tmp:rw,size=16m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p 127.0.0.1:3080:3080 \
  -p 127.0.0.1:3443:3443 \
  ptk-playground
```

## Direct scanner targets

Focused targets remain directly addressable without progress state, hints or
presentation code. Static hosting leaves protocol-dependent targets disabled
rather than inventing a localhost URL.

Useful entry points:

- `/explore/` — complete human-readable catalogue;
- `/jwt/` — JWT storage discovery and local request-carrier lab;
- `/scanner/` — compatibility directory for current paired missions;
- `catalog/challenges.json` — canonical public challenge catalogue;
- `catalog/families.json` — human-readable groupings;
- `catalog/playlists.json` — guided challenge references; and
- `catalog/generated/scanner-targets.json` — complete scanner-neutral target
  feed generated from the canonical catalogue;
- `catalog/generated/counts.json` — generated corpus and engine counts;
- `catalog/legacy-routes.json` — frozen compatibility route inventory.

Public metadata describes routes and browser behaviour. It does not contain
private PTK rule IDs, payloads, matchers, scan policies, expected findings,
credentials or extension-specific control APIs.

## Full-corpus accounting

The migration is driven by `catalog/source-ledger.json`. It records every
selected source file, its hash, role, disposition, public route and discovered
scenario markers.

The ledger separates:

- reviewed focused targets and their generated source files;
- generated family directories, retained historical Advanced pages and their
  migrated child assertions;
- indexes and presentation shells;
- target helpers and runtime templates; and
- pinned third-party dependencies.

Every discovered marker has an explicit assertion, control, setup or helper
role. Authored assertions are linked to an isolated SAST/IAST challenge or an
explicit route-aware DAST contract. The source-migration flag therefore means
the public fixture is accounted for; it does not claim that every scanner has
been proven to report every case.

Additional generated catalogues document:

- every route-aware endpoint as a security target or runtime support route;
- allowed transport and HTTP methods for DAST targets;
- pinned SCA resource hashes, licences, loading conditions and controls; and
- all direct review/repaired targets without presentation or product-policy
  metadata.

Regenerate and verify the public catalogues with:

```bash
npm run catalog:generate
npm run catalog:check
```

## PTK Pro preview

Selected presentation cards may be labelled **PTK Pro — Coming soon** or **In
progress** to show future coverage direction. This is roadmap metadata only.
The direct targets remain open and scanner-neutral, and no private executable
rulepack content is published in this repository. The homepage does not carry
a separate Pro section.

## Repository structure

```text
ptk-playground/
├── play/                    Guided playlists
├── explore/                 Complete filterable catalogue
├── catalog/                 Canonical and compatibility metadata
├── atomic/                  Generated isolated SAST and IAST target pairs
├── targets/                 Direct review and repaired targets
├── sast/                    SAST family directories and Advanced labs
├── iast/                    IAST family directories and Advanced labs
├── passive/                 Route-aware DAST fixtures and local server
├── campaigns/               Compatibility mission views
├── demo/                    Compatibility presenter view
├── scanner/                 Compatibility direct-target directory
├── assets/                  Self-hosted UI and pinned dependencies
├── scripts/                 Deterministic catalogue and readiness tools
└── test/                    Structural and browser contracts
```

Exact PTK rule mappings and expected-result assertions are maintained outside
this public fixture repository. The public catalogue proves fixture contracts;
PTK result parity remains an evidence gate in the PTK test owner.

## Validate the playground

Install the pinned development dependency and run all public tests:

```bash
npm install
npm run test:all
```

The suite checks:

- full source-ledger and legacy-route accounting;
- canonical challenge, family and playlist integrity;
- complete generated scanner-target and count projections;
- separate SAST/IAST review and repaired source files;
- unique family-directory links and preserved Advanced combined labs;
- complete DAST runtime-route classification and bounded active-request
  methods;
- SCA resource checksums, licences, load timing and repaired controls;
- GitHub Pages project-subpath behaviour;
- static versus route-aware target handling;
- review/repaired target isolation;
- self-hosted executable resources;
- responsive desktop and mobile layouts; and
- absence of public private-rule or product-policy leakage.

Some historical SAST labs intentionally retain a bounded set of remote library
references from the original corpus. Structural tests freeze that list so it
cannot grow silently. Focused and newly created challenges must use reviewed
local dependencies.

## Add or migrate a challenge

1. Register the source and scenario in the migration ledger.
2. Keep one declared security assertion per focused target.
3. Create a separate meaningful repaired control where applicable.
4. Keep requests and navigation inside the authorised fixture origin.
5. Keep vulnerable implementation code target-local so SAST isolation remains
   meaningful.
6. Update the canonical catalogue generator and structural contracts.
7. Validate the visible behaviour in supported browsers.
8. Maintain PTK-specific expected findings in the private/internal test owner,
   not in this public repository.

Do not add credentials, extension-private APIs, remote executable code, scan
policies or executable rule definitions.

## Project links

- [OWASP PTK project](https://owasp.org/www-project-penetration-testing-kit/)
- [OWASP PTK source and pentester guide](https://github.com/DenisPodgurskii/pentestkit)
- [PTK Agent](https://github.com/ptklabs/ptk-agent)
- [PTK Agent on npm](https://www.npmjs.com/package/pentestkit)

## Licence

This repository is licensed under the [MIT License](LICENSE).
