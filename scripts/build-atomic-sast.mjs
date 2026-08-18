import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/source-ledger.json'), 'utf8'))
const outputRoot = path.join(repoRoot, 'atomic/sast')
const expectedGeneratedFiles = new Set()
if (!checkOnly && fs.existsSync(outputRoot)) fs.rmSync(outputRoot, { recursive: true, force: true })

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'case'
}

function htmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function jsText(value) {
  return JSON.stringify(String(value))
}

function sourceExpression(label) {
  const value = label.toLowerCase()
  if (value.includes('urlsearchparams') || value.includes('location.search')) {
    return `new URLSearchParams(location.search).get('value') || input.value`
  }
  if (value.includes('location.hash') || value.includes('from hash') || value.includes('hash →')) {
    return `decodeURIComponent(location.hash.slice(1)) || input.value`
  }
  if (value.includes('window.name')) return `window.name || input.value`
  if (value.includes('referrer')) return `document.referrer || input.value`
  if (value.includes('document.cookie') || value.includes('from cookie')) {
    return `(document.cookie.match(/(?:^|;\\s*)ptk_atomic_source=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\\s*)ptk_atomic_source=([^;]*)/)[1]) : input.value)`
  }
  if (value.includes('localstorage')) return `localStorage.getItem('ptkAtomicSource') || input.value`
  if (value.includes('sessionstorage')) return `sessionStorage.getItem('ptkAtomicSource') || input.value`
  if (value.includes('element.value') || value.includes('field') || value.includes('inline')) return `input.value`
  return `input.value`
}

function defaultValue(entry) {
  const family = `${entry.sourcePath} ${entry.label}`.toLowerCase()
  if (/eval|function_constructor|javascript_injection/.test(family)) return `document.querySelector('#output').textContent='PTK atomic evidence'`
  if (/open_redirect|link_manipulation|xhr-open|script|service_worker/.test(family)) return '#ptk-atomic-evidence'
  if (/dom_selector|web_message.*selector|message.*selector/.test(family)) return '#output'
  if (/cookie\.html/.test(family)) return 'ptk_atomic_source=PTK-evidence; SameSite=Strict'
  if (/prototype_pollution|client_injection/.test(family)) return '{"name":"PTK evidence","__proto__":{"ptk":true}}'
  if (/jwt_client_misuse/.test(family)) return 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.'
  return `<strong data-ptk-evidence='atomic'>PTK atomic evidence</strong>`
}

function operationKind(sourcePath, label) {
  const family = `${sourcePath} ${label}`.toLowerCase()
  if (family.includes('web_message')) {
    if (family.includes('wildcard-target')) return 'postmessage-wildcard-target'
    if (family.includes('missing-target')) return 'postmessage-missing-target'
    if (family.includes('eval')) return 'message-to-eval'
    if (family.includes('location')) return 'message-to-navigation'
    if (family.includes('cookie')) return 'message-to-cookie'
    if (family.includes('selector')) return 'message-to-selector'
    return 'message-to-html'
  }
  if (family.includes('ajax_request_header')) {
    if (family.includes('xhr-open')) return 'xhr-open-url'
    if (family.includes('global-eval')) return 'global-eval'
    if (family.includes('message-listener')) return 'message-to-html'
    return 'xhr-request-header'
  }
  if (family.includes('append_child')) return 'append-contextual-fragment'
  if (family.includes('document_write')) return 'document-write'
  if (family.includes('insert_adjacent_html')) return 'insert-adjacent-html'
  if (family.includes('inner_html') || family.includes('client_template_injection')) return 'inner-html'
  if (family.includes('function_constructor')) return 'function-constructor'
  if (family.includes('/eval.html')) return family.includes('settimeout') ? 'string-timeout' : 'eval'
  if (family.includes('javascript_injection_taint')) {
    if (family.includes('execscript')) return 'exec-script'
    if (family.includes('jquery')) return 'jquery-html'
    if (family.includes('execcommand')) return 'exec-command-insert-html'
    if (family.includes('fragment')) return 'insert-adjacent-html'
    if (family.includes('crmf')) return 'crmf-request'
    if (family.includes('script')) return 'script-text'
    if (family.includes('timer')) return 'string-timeout'
    return 'eval'
  }
  if (family.includes('cookie.html')) return 'cookie-assignment'
  if (family.includes('open_redirect')) return 'location-assign'
  if (family.includes('link_manipulation')) return 'link-href-assignment'
  if (family.includes('dom_selector')) return 'dom-selector'
  if (family.includes('prototype_pollution')) return 'object-merge'
  if (family.includes('service_worker')) return 'service-worker-register'
  if (family.includes('storage_security')) return 'local-storage-write'
  if (family.includes('jwt_client_misuse')) return 'jwt-claim-trust'
  if (family.includes('client_injection')) {
    if (family.includes('eval from json')) return 'json-to-eval'
    if (family.includes('xpath')) return 'xpath-expression'
    if (family.includes('json') || family.includes('selector')) return 'selector-construction'
    return 'sql-string-construction'
  }
  if (family.includes('dom_data_manipulation')) {
    if (family.includes('script')) return 'script-src-assignment'
    if (family.includes('navigation') || family.includes('destination')) return 'link-href-assignment'
    if (family.includes('style')) return 'style-attribute-assignment'
    if (family.includes('history')) return 'history-url-replacement'
    return 'inner-html'
  }
  if (family.includes('dom_clobbering')) return 'dom-clobbering-markup'
  if (family.includes('secrets')) return 'client-secret-literal'
  if (family.includes('test.html')) return 'inner-html'
  return 'inner-html'
}

function vulnerableOperation(sourcePath, label) {
  const family = `${sourcePath} ${label}`.toLowerCase()
  const source = sourceExpression(label)
  if (family.includes('web_message') || family.includes('message-listener')) {
    if (family.includes('wildcard-target')) return `window.postMessage(${source}, '*');\nevidence.textContent = 'Value sent with wildcard target origin';`
    if (family.includes('missing-target')) return `window.postMessage(${source});\nevidence.textContent = 'Message sent without an explicit target origin';`
    if (family.includes('eval')) return `window.addEventListener('message', (event) => { eval(String(event.data)); evidence.textContent = 'Message evaluated'; }, { once: true });\nwindow.postMessage(${source}, location.origin);`
    if (family.includes('location')) return `window.addEventListener('message', (event) => { location.assign(String(event.data)); }, { once: true });\nwindow.postMessage('#ptk-message-route', location.origin);`
    if (family.includes('cookie')) return `window.addEventListener('message', (event) => { document.cookie = String(event.data); evidence.textContent = 'Cookie write attempted'; }, { once: true });\nwindow.postMessage(${source}, location.origin);`
    if (family.includes('selector')) return `window.addEventListener('message', (event) => { document.querySelector(String(event.data)); evidence.textContent = 'Selector evaluated'; }, { once: true });\nwindow.postMessage(${source}, location.origin);`
    return `window.addEventListener('message', (event) => { output.innerHTML = String(event.data); evidence.textContent = 'Message rendered as HTML'; }, { once: true });\nwindow.postMessage(${source}, location.origin);`
  }
  if (family.includes('ajax_request_header')) {
    if (family.includes('copy-cookie') || family.includes('setrequestheader')) return `const request = new XMLHttpRequest();\nrequest.open('GET', location.pathname);\nrequest.setRequestHeader('X-Playground-Value', ${source});\nevidence.textContent = 'Request header prepared';`
    if (family.includes('xhr-open')) return `const request = new XMLHttpRequest();\nrequest.open('GET', ${source});\nevidence.textContent = 'Request URL prepared';`
    if (family.includes('global-eval')) return `eval(${source});\nevidence.textContent = 'Value evaluated';`
    return `window.addEventListener('message', (event) => { output.innerHTML = String(event.data); }, { once: true });\nwindow.postMessage(${source}, location.origin);\nevidence.textContent = 'Message flow triggered';`
  }
  if (family.includes('append_child')) return `const range = document.createRange();\nconst fragment = range.createContextualFragment(${source});\noutput.appendChild(fragment);\nevidence.textContent = 'Fragment appended';`
  if (family.includes('document_write')) return `const preview = document.querySelector('#preview').contentWindow.document;\npreview.open();\npreview.write(${source});\npreview.close();\nevidence.textContent = 'Document stream written';`
  if (family.includes('insert_adjacent_html')) return `output.insertAdjacentHTML('beforeend', ${source});\nevidence.textContent = 'Markup inserted';`
  if (family.includes('inner_html') || family.includes('client_template_injection')) return `output.innerHTML = ${source};\nevidence.textContent = 'Value rendered as HTML';`
  if (family.includes('function_constructor')) return `const operation = new Function(${source});\noperation();\nevidence.textContent = 'Function constructed';`
  if (family.includes('/eval.html') || family.includes('javascript_injection_taint')) {
    if (family.includes('settimeout') || family.includes('timer')) return `setTimeout(${source}, 0);\nevidence.textContent = 'String timer scheduled';`
    if (family.includes('script-text') || family.includes('inline script')) return `const script = document.createElement('script');\nscript.text = ${source};\ndocument.body.appendChild(script);\nevidence.textContent = 'Script text appended';`
    if (family.includes('execscript')) return `if (typeof window.execScript === 'function') window.execScript(${source}); else eval(${source});\nevidence.textContent = 'Legacy execution boundary reached';`
    if (family.includes('jquery')) return `output.innerHTML = ${source};\nevidence.textContent = 'HTML helper boundary reached';`
    if (family.includes('execcommand')) return `output.focus();\ndocument.execCommand('insertHTML', false, ${source});\nevidence.textContent = 'insertHTML command reached';`
    if (family.includes('crmf')) return `if (typeof crypto.generateCRMFRequest === 'function') crypto.generateCRMFRequest(${source}); else throw new Error('CRMF API unavailable');\nevidence.textContent = 'CRMF generation boundary reached';`
    if (family.includes('inserthtml') || family.includes('fragment')) return `output.insertAdjacentHTML('beforeend', ${source});\nevidence.textContent = 'HTML fragment inserted';`
    return `eval(${source});\nevidence.textContent = 'Value evaluated';`
  }
  if (family.includes('cookie.html')) return `document.cookie = ${source};\nevidence.textContent = 'Cookie assignment attempted';`
  if (family.includes('open_redirect')) return `location.assign(${source});`
  if (family.includes('link_manipulation')) return `document.querySelector('#case-link').href = ${source};\nevidence.textContent = 'Link target updated';`
  if (family.includes('dom_selector')) return `document.querySelector(${source});\nevidence.textContent = 'Selector evaluated';`
  if (family.includes('prototype_pollution')) return `const parsed = JSON.parse(${source});\nObject.assign({}, parsed);\nevidence.textContent = 'Imported object merged';`
  if (family.includes('service_worker')) return `navigator.serviceWorker.register(${source});\nevidence.textContent = 'Registration attempted';`
  if (family.includes('storage_security')) return `localStorage.setItem('ptkAtomicToken', ${source});\nevidence.textContent = 'Value persisted';`
  if (family.includes('jwt_client_misuse')) return `const payload = JSON.parse(atob(${source}.split('.')[1]));\noutput.textContent = payload.role || 'No role';\nevidence.textContent = 'Unsigned client claim trusted';`
  if (family.includes('client_injection')) {
    if (family.includes('eval from json')) return `const parsed = JSON.parse(${source});\neval(String(parsed.name || ''));\nevidence.textContent = 'Parsed JSON value evaluated';`
    if (family.includes('xpath')) return `const expression = "//user[name='" + ${source} + "']";\ndocument.evaluate(expression, document, null, XPathResult.ANY_TYPE, null);\nevidence.textContent = expression;`
    if (family.includes('json') || family.includes('selector')) return `const selector = '[data-user="' + ${source} + '"]';\ndocument.querySelector(selector);\nevidence.textContent = selector;`
    return `const statement = "SELECT * FROM users WHERE name='" + ${source} + "'";\nevidence.textContent = statement;`
  }
  if (family.includes('dom_data_manipulation')) {
    if (family.includes('script')) return `const script = document.createElement('script');\nscript.src = ${source};\ndocument.head.appendChild(script);\nevidence.textContent = 'Script source assigned';`
    if (family.includes('navigation') || family.includes('destination')) return `document.querySelector('#case-link').href = ${source};\nevidence.textContent = 'Navigation target assigned';`
    if (family.includes('style')) return `output.setAttribute('style', ${source});\nevidence.textContent = 'Style attribute assigned';`
    if (family.includes('history')) return `history.replaceState({}, '', ${source});\nevidence.textContent = 'History URL replaced';`
    return `output.innerHTML = ${source};\nevidence.textContent = 'Profile rendered as HTML';`
  }
  if (family.includes('dom_clobbering')) return `output.innerHTML = '<form id="settings"><input name="endpoint" value="/preview"></form>';\nevidence.textContent = String(window.settings?.endpoint?.value || 'clobbered');`
  if (family.includes('secrets')) return `const clientSecret = ${source};\nevidence.textContent = clientSecret;`
  return `output.innerHTML = ${source};\nevidence.textContent = 'Value reached the review boundary';`
}

function repairedOperation(sourcePath, label) {
  const family = `${sourcePath} ${label}`.toLowerCase()
  const source = sourceExpression(label)
  if (family.includes('open_redirect')) return `const destination = new URL(${source}, location.href);\nif (destination.origin === location.origin) location.assign(destination.pathname + destination.hash);\nelse evidence.textContent = 'External destination rejected';`
  if (family.includes('link_manipulation') || family.includes('navigation') || family.includes('xhr-open')) return `const destination = new URL(${source}, location.href);\nconst link = document.querySelector('#case-link');\nlink.href = destination.origin === location.origin ? destination.pathname + destination.hash : '#rejected';\nevidence.textContent = destination.origin === location.origin ? 'Same-origin target accepted' : 'External target rejected';`
  if (family.includes('dom_selector')) return `const allowed = new Set(['#output', '#evidence']);\nconst selector = allowed.has(${source}) ? ${source} : '#output';\ndocument.querySelector(selector);\nevidence.textContent = 'Allow-listed selector used';`
  if (family.includes('cookie.html')) return `document.cookie = 'ptk_atomic_value=' + encodeURIComponent(${source}) + '; SameSite=Strict';\nevidence.textContent = 'Cookie value encoded';`
  if (family.includes('prototype_pollution')) return `const parsed = JSON.parse(${source});\nconst result = Object.create(null);\nfor (const key of Object.keys(parsed)) if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') result[key] = parsed[key];\nevidence.textContent = 'Dangerous object keys rejected';`
  if (family.includes('service_worker')) return `const allowedScript = './service-worker.js';\nif (${source} === allowedScript) navigator.serviceWorker.register(allowedScript);\nevidence.textContent = 'Constant service-worker path enforced';`
  if (family.includes('storage_security')) return `const ephemeralValue = ${source};\nsessionStorage.removeItem('ptkAtomicToken');\noutput.textContent = ephemeralValue;\nevidence.textContent = 'Sensitive value not persisted';`
  if (family.includes('jwt_client_misuse')) return `const token = ${source};\noutput.textContent = token ? 'Token present; authorization remains server-side' : 'No token';\nevidence.textContent = 'Client claim not trusted';`
  if (family.includes('ajax_request_header') || family.includes('client_injection')) return `output.textContent = ${source};\nevidence.textContent = 'Value kept as data';`
  if (family.includes('function_constructor') || family.includes('/eval.html') || family.includes('javascript_injection_taint')) return `output.textContent = ${source};\nevidence.textContent = 'Value displayed without execution';`
  if (family.includes('document_write')) return `const preview = document.querySelector('#preview').contentWindow.document;\npreview.open();\nconst node = preview.createElement('p');\nnode.textContent = ${source};\npreview.body.appendChild(node);\npreview.close();\nevidence.textContent = 'Document content written as text';`
  if (family.includes('web_message') || family.includes('message-listener')) return `window.addEventListener('message', (event) => {\n  if (event.origin !== location.origin || typeof event.data !== 'string') return;\n  output.textContent = event.data;\n  evidence.textContent = 'Validated message displayed as text';\n}, { once: true });\nwindow.postMessage(${source}, location.origin);`
  if (family.includes('dom_data_manipulation') && family.includes('style')) return `output.className = ${source} === 'highlight' ? 'highlight' : '';\nevidence.textContent = 'Known style selected';`
  return `output.textContent = ${source};\nevidence.textContent = 'Value displayed as text';`
}

function scriptFor(entry, variant) {
  const operation = variant === 'review'
    ? vulnerableOperation(entry.sourcePath, `${entry.anchor} ${entry.label}`)
    : repairedOperation(entry.sourcePath, `${entry.anchor} ${entry.label}`)
  return `const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = ${jsText(defaultValue(entry))}

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    ${operation.replace(/\n/g, '\n    ')}
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
`
}

function rootRoute(relativePath) {
  return `../../../../../${String(relativePath).replace(/^\.\//, '')}`
}

function supportRequirements(entry) {
  return {
    link: ['link-href-assignment', 'xhr-open-url'].includes(entry.operationKind),
    preview: entry.operationKind === 'document-write'
  }
}

function pageFor(entry, variant) {
  const repaired = variant === 'fixed'
  const title = repaired ? `${entry.label} — repaired control` : entry.label
  const stateLabel = repaired ? 'Repaired control' : 'Review target'
  const counterpartLabel = repaired ? 'Open review target' : 'Open repaired control'
  const counterpartRoute = repaired ? '../review/' : '../fixed/'
  const support = supportRequirements(entry)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlText(title)} · OWASP PTK Playground</title>
  <link rel="stylesheet" href="../../../../../assets/css/playground.css">
</head>
<body class="target-page engine-page engine-page--sast">
  <a class="skip-link" href="#workbench">Skip to case</a>
  <header class="site-header atomic-site-header">
    <div class="site-header__inner">
      <a class="brand" href="${rootRoute('./')}"><span class="brand__mark" aria-hidden="true">PTK</span><span>OWASP PTK Playground</span></a>
      <nav class="site-nav" aria-label="Atomic target navigation"><a href="${rootRoute(entry.sourcePath)}">Case family</a><a href="${rootRoute('./explore/?engine=SAST')}">Explore SAST</a></nav>
    </div>
  </header>
  <main class="page-shell target-shell atomic-shell" data-atomic-sast-id="${htmlText(entry.id)}" data-variant="${variant}">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${rootRoute('./')}">Playground</a><span aria-hidden="true">/</span><a href="${rootRoute('./sast/')}">SAST</a><span aria-hidden="true">/</span><a href="${rootRoute(entry.sourcePath)}">Case family</a><span aria-hidden="true">/</span><span>${stateLabel}</span></nav>
    <section class="atomic-hero atomic-hero--${variant}">
      <div class="atomic-hero__copy">
        <div class="atomic-kicker"><span class="atomic-engine-badge">SAST</span><span class="atomic-state-badge">${stateLabel}</span></div>
        <h1>${htmlText(title)}</h1>
        <p>${repaired ? 'The same prepared input and user action are preserved while the unsafe static code boundary is removed.' : 'A single browser-code flow is isolated from the combined compatibility lab so its source, operation and result are easy to review.'}</p>
      </div>
      <div class="atomic-hero__actions">
        <a class="button" href="${counterpartRoute}">${counterpartLabel}</a>
        <a class="button button--secondary" href="${rootRoute(entry.sourceRoute)}">Open Advanced source</a>
      </div>
    </section>

    <ol class="atomic-steps" aria-label="How to use this SAST case">
      <li><span>1</span><div><strong>Start SAST</strong><p>Scan this document. Static analysis should review the code path without requiring the action.</p></div></li>
      <li><span>2</span><div><strong>Inspect the prepared flow</strong><p>Review or edit the harmless input, then run the case to see its browser behavior.</p></div></li>
      <li><span>3</span><div><strong>Compare the pair</strong><p>Open the ${repaired ? 'review target' : 'repaired control'} and confirm the code boundary—not the intended interaction—changes.</p></div></li>
    </ol>

    <section id="workbench" class="atomic-workbench" aria-label="SAST scenario workbench">
      <article class="atomic-panel atomic-panel--input">
        <div class="atomic-panel__heading"><div><p class="eyebrow">Prepared flow</p><h2>Input and action</h2></div><span class="atomic-panel__step">01</span></div>
        <label class="atomic-field-label" for="case-input">Harmless test value</label>
        <textarea class="atomic-input" id="case-input" rows="4" spellcheck="false"></textarea>
        <p class="atomic-help">The value is intentionally visible and editable. It demonstrates the data flow without using a destructive payload.</p>
        <div class="atomic-action-row">
          <button class="button" id="run-case" type="button">Run focused case</button>
          <a class="button button--secondary" id="case-link" href="#output"${support.link ? '' : ' hidden'}>Open prepared link</a>
        </div>
      </article>

      <article class="atomic-panel atomic-panel--evidence">
        <div class="atomic-panel__heading"><div><p class="eyebrow">Browser proof</p><h2>Visible evidence</h2></div><span class="atomic-panel__step">02</span></div>
        <div class="atomic-output" id="output" data-empty-label="The visible result will appear here."></div>
        <iframe class="atomic-preview" id="preview" title="Document output preview"${support.preview ? '' : ' hidden'}></iframe>
        <p class="atomic-evidence-status" id="evidence" data-state="ready"><span aria-hidden="true"></span>Ready to run</p>
      </article>
    </section>

    <aside class="atomic-pair-note atomic-pair-note--${variant}">
      <div><p class="eyebrow">Paired verification</p><h2>${repaired ? 'Behavior preserved, unsafe boundary removed' : 'A finding needs a clean comparison'}</h2><p>${repaired ? 'Use this page after the review target. The action remains available, but untrusted input is kept as data.' : 'After reviewing this page, open the repaired control and verify that the same user-facing action no longer crosses the unsafe boundary.'}</p></div>
      <a class="button button--secondary" href="${counterpartRoute}">${counterpartLabel}</a>
    </aside>
  </main>
  <footer class="site-footer"><div class="site-footer__inner"><p>SAST atomic target · scanner-neutral and locally reproducible.</p><nav aria-label="Project links"><a href="${rootRoute(entry.sourcePath)}">Case family</a><a href="${rootRoute('./explore/?engine=SAST')}">Explore SAST</a></nav></div></footer>
  <script src="./case.js"></script>
</body>
</html>
`
}

function write(relativePath, content) {
  if (relativePath.startsWith('atomic/sast/')) expectedGeneratedFiles.add(relativePath)
  const absolute = path.join(repoRoot, relativePath)
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) {
      throw new Error(`${relativePath} is stale; run npm run catalog:generate`)
    }
    return
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
}

function walk(relativeDirectory) {
  const absolute = path.join(repoRoot, relativeDirectory)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name)
    return entry.isDirectory() ? walk(relative) : [relative]
  })
}

const sourceEntries = ledger.sources
  .filter((source) => source.role === 'legacy-aggregate' && source.path.startsWith('sast/'))
  .flatMap((source) => (source.scenarios || [])
    .filter((scenario) => scenario.role === 'assertion')
    .map((scenario) => {
      const canonicalPath = source.canonicalPath || source.path
      return {
        id: `sast.atomic.${slug(canonicalPath.replace(/\.html$/i, ''))}.${slug(scenario.id.split('.').at(-1))}`,
        title: scenario.label,
        label: scenario.label,
        anchor: scenario.anchor,
        sourceId: source.id,
        sourcePath: canonicalPath,
        sourceRoute: `${source.route}#${encodeURIComponent(scenario.anchor)}`,
        sourceScenarioId: scenario.id,
        operationKind: operationKind(canonicalPath, `${scenario.anchor} ${scenario.label}`),
        severity: scenario.severity || null,
        directory: `atomic/sast/${slug(canonicalPath.replace(/\.html$/i, ''))}/${slug(scenario.id.split('.').at(-1))}`
      }
    }))
  .sort((left, right) => left.id.localeCompare(right.id))

const ids = new Set()
for (const entry of sourceEntries) {
  if (ids.has(entry.id)) throw new Error(`duplicate atomic SAST id: ${entry.id}`)
  ids.add(entry.id)
  write(`${entry.directory}/review/index.html`, pageFor(entry, 'review'))
  write(`${entry.directory}/review/case.js`, scriptFor(entry, 'review'))
  write(`${entry.directory}/fixed/index.html`, pageFor(entry, 'fixed'))
  write(`${entry.directory}/fixed/case.js`, scriptFor(entry, 'fixed'))
}

const document = {
  schema: 'owasp-ptk-playground-atomic-sast/v1',
  version: 1,
  generatedFrom: 'catalog/source-ledger.json',
  summary: {
    challenges: sourceEntries.length,
    pairedTargets: sourceEntries.length * 2
  },
  challenges: sourceEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    sourceId: entry.sourceId,
    sourcePath: entry.sourcePath,
    sourceRoute: entry.sourceRoute,
    sourceScenarioId: entry.sourceScenarioId,
    sourceAnchor: entry.anchor,
    operationKind: entry.operationKind,
    ...(entry.severity ? { historicalSeverity: entry.severity } : {}),
    reviewRoute: `./${entry.directory}/review/`,
    repairedRoute: `./${entry.directory}/fixed/`
  }))
}
write('catalog/sast-atomic.json', `${JSON.stringify(document, null, 2)}\n`)
const actualGeneratedFiles = walk('atomic/sast').sort()
const expectedFiles = [...expectedGeneratedFiles].sort()
if (JSON.stringify(actualGeneratedFiles) !== JSON.stringify(expectedFiles)) throw new Error('atomic/sast contains stale or missing generated files')

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', ...document.summary }))
