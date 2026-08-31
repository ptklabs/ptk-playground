import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/source-ledger.json'), 'utf8'))
const outputRoot = path.join(repoRoot, 'atomic/iast')
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

function defaultValue(entry) {
  const value = `${entry.sourcePath} ${entry.label}`.toLowerCase()
  if (/domparser|srcdoc/.test(value)) return `<strong data-ptk-evidence="runtime">PTK runtime evidence</strong>`
  if (/eval|function|timer|script|javascript|worker/.test(value)) return `document.querySelector('#output').textContent='PTK runtime evidence'`
  if (/json|prototype|sql/.test(value)) return `{"name":"PTK runtime evidence","__proto__":{"ptk":true}}`
  if (/url|navigation|redirect|action|href|src|websocket|request|fetch|xhr|beacon|image/.test(value)) return `ptk-runtime-evidence`
  return `<strong data-ptk-evidence="runtime">PTK runtime evidence</strong>`
}

function operationKind(sourcePath, label) {
  const value = `${sourcePath} ${label}`.toLowerCase()
  const mappings = [
    ['blob_object_url', 'blob-object-url'], ['client_http_exfiltration', 'client-request'],
    ['client_json_parsing', 'json-parse'], ['client_sql_injection', 'client-sql'],
    ['clipboard_exfiltration', 'clipboard-write'], ['csrf_like_requests', 'credentialed-request'],
    ['debug_logging', 'debug-log'], ['document_domain', 'document-domain'],
    ['dom_clobbering', 'dom-clobbering'], ['dom_parser_xss', 'dom-parser'],
    ['dom_url_navigation', 'dom-navigation'], ['dom_xss_secondary_sources', 'secondary-source-dom-xss'],
    ['dom_xss', 'dom-xss'], ['dynamic_script_loading', 'dynamic-script'],
    ['file_reader', 'file-reader'], ['form_submission_hijack', 'form-navigation'],
    ['form_submit_csrf', 'form-submission'], ['iframe_navigation', 'iframe-navigation'],
    ['inbound_channel_trust', 'inbound-channel'], ['indexeddb_cache_storage', 'browser-database-cache'],
    ['js_execution', 'javascript-execution'], ['open_redirect', 'open-redirect'],
    ['postmessage_misuse', 'postmessage'], ['prototype_pollution_impact', 'prototype-impact'],
    ['realtime_exfiltration', 'realtime-channel'], ['referrer_helper', 'referrer-child'],
    ['response_field_reachability', 'response-field'], ['route_controlled_navigation', 'route-navigation'],
    ['iast_runtime', 'runtime-dom-boundary'], ['session_material_cross_boundary', 'session-material-channel'],
    ['storage_backed_request_reuse', 'storage-request'], ['storage_taint_to_exec', 'storage-execution'],
    ['storage_token_leaks', 'storage-token-write'], ['timer_js_execution', 'string-timer'],
    ['trusted_types_and_sanitizer', 'trusted-types-sanitizer'], ['web_messaging_channels', 'web-message-channel'],
    ['websocket_url_poisoning', 'websocket-url'], ['worker_script_loading', 'worker-script'],
    ['xpath_injection', 'xpath-expression']
  ]
  const mapping = mappings.find(([needle]) => value.includes(needle))
  return mapping?.[1] || 'runtime-boundary'
}

function reviewOperation(entry) {
  const value = `${entry.sourcePath} ${entry.label}`.toLowerCase()
  const supplied = 'input.value'
  const localUrl = "new URL(location.pathname + '?ptk=' + encodeURIComponent(input.value), location.href).href"

  if (value.includes('blob_object_url')) {
    if (value.includes('worker')) return `const blob = new Blob([${supplied}], { type: 'application/javascript' });\nconst objectUrl = URL.createObjectURL(blob);\nconst worker = new Worker(objectUrl);\nworker.terminate();\nURL.revokeObjectURL(objectUrl);\nevidence.textContent = 'Blob URL reached Worker';`
    if (value.includes('iframe')) return `const blob = new Blob([${supplied}], { type: 'text/html' });\nconst objectUrl = URL.createObjectURL(blob);\ndocument.querySelector('#preview').src = objectUrl;\nevidence.textContent = 'Blob URL reached iframe.src';`
    return `const blob = new Blob([${supplied}], { type: 'application/javascript' });\nconst objectUrl = URL.createObjectURL(blob);\nconst script = document.createElement('script');\nscript.src = objectUrl;\ndocument.head.appendChild(script);\nevidence.textContent = 'Blob URL reached script.src';`
  }
  if (value.includes('client_http_exfiltration') || value.includes('session_material_cross_boundary') || value.includes('storage_backed_request_reuse')) {
    if (value.includes('xmlhttprequest') || value.includes('xhr')) return `const request = new XMLHttpRequest();\nrequest.open('GET', ${localUrl});\nrequest.setRequestHeader('X-PTK-Value', ${supplied});\nrequest.send();\nevidence.textContent = 'Value sent through XHR';`
    if (value.includes('sendbeacon')) return `navigator.sendBeacon(${localUrl}, ${supplied});\nevidence.textContent = 'Value sent through beacon';`
    if (value.includes('image')) return `document.querySelector('#case-image').src = ${localUrl};\nevidence.textContent = 'Value assigned to image request';`
    if (value.includes('websocket')) return `const socketUrl = new URL('/passive/realtime/ws', location.href);\nsocketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';\nconst socket = new WebSocket(socketUrl);\nsocket.addEventListener('open', () => { socket.send(${supplied}); socket.close(); });\nevidence.textContent = 'Value queued for WebSocket';`
    if (value.includes('postmessage')) return `window.postMessage(${supplied}, '*');\nevidence.textContent = 'Value posted with wildcard target';`
    if (value.includes('rtcdatachannel')) return `const peer = new RTCPeerConnection();\nconst channel = peer.createDataChannel('ptk');\nchannel.send(${supplied});\nevidence.textContent = 'Value reached RTCDataChannel.send';`
    if (value.includes('headers') || value.includes('authorization')) return `await fetch(${localUrl}, { headers: { Authorization: ${supplied} } });\nevidence.textContent = 'Value sent in request header';`
    if (value.includes('post') || value.includes('body')) return `await fetch(${localUrl}, { method: 'POST', body: ${supplied} });\nevidence.textContent = 'Value sent in request body';`
    return `await fetch(${localUrl});\nevidence.textContent = 'Value used in request URL';`
  }
  if (value.includes('client_json_parsing')) return `const parsed = JSON.parse(${supplied});\noutput.textContent = String(parsed.name || 'Parsed');\nevidence.textContent = 'Value passed to JSON.parse';`
  if (value.includes('client_sql_injection')) {
    if (value.includes('executesql')) return `const statement = "SELECT * FROM notes WHERE title='" + ${supplied} + "'";\nif (typeof openDatabase === 'function') openDatabase('ptk', '1.0', 'PTK', 1024).transaction((tx) => tx.executeSql(statement));\nevidence.textContent = statement;`
    return `const databaseName = ${supplied};\nif (typeof openDatabase === 'function') openDatabase(databaseName, '1.0', 'PTK', 1024);\nevidence.textContent = 'Value used by Web SQL';`
  }
  if (value.includes('clipboard_exfiltration')) return `await navigator.clipboard.writeText(${supplied});\nevidence.textContent = 'Value written to clipboard';`
  if (value.includes('csrf_like_requests')) return `await fetch(${localUrl}, { method: 'POST', credentials: 'include', body: ${supplied} });\nevidence.textContent = 'Credentialed request sent';`
  if (value.includes('debug_logging')) {
    if (value.includes('error')) return `console.error(${supplied});\nevidence.textContent = 'Value written to error log';`
    return `console.log(${supplied});\nevidence.textContent = 'Value written to console log';`
  }
  if (value.includes('document_domain')) return `document.domain = ${supplied};\nevidence.textContent = 'document.domain assignment attempted';`
  if (value.includes('dom_clobbering')) return `output.innerHTML = '<form name="' + ${supplied} + '"><input name="endpoint"></form>';\nevidence.textContent = 'Named element created';`
  if (value.includes('dom_parser_xss')) {
    if (value.includes('range')) return `const fragment = document.createRange().createContextualFragment(${supplied});\noutput.appendChild(fragment);\nevidence.textContent = 'Contextual fragment appended';`
    if (value.includes('sethtmlunsafe')) return `if (typeof output.setHTMLUnsafe === 'function') output.setHTMLUnsafe(${supplied}); else output.innerHTML = ${supplied};\nevidence.textContent = 'Unsafe HTML parser reached';`
    return `const mime = document.querySelector('#parser-mime')?.value || 'text/html';\nconst parsed = new DOMParser().parseFromString(${supplied}, mime);\noutput.replaceChildren(document.importNode(parsed.documentElement, true));\nevidence.textContent = 'DOMParser result appended for ' + mime;`
  }
  if (value.includes('response_field_reachability')) {
    const load = `const response = await fetch('./payload.json').then((result) => result.json())`
    if (value.includes('outerhtml')) return `${load};\noutput.outerHTML = '<div id="output">' + response.html + '</div>';\nevidence.textContent = 'Response field reached outerHTML';`
    if (value.includes('insertadjacenthtml')) return `${load};\noutput.insertAdjacentHTML('beforeend', response.htmlFragment);\nevidence.textContent = 'Response field reached insertAdjacentHTML';`
    if (value.includes('document.write')) return `${load};\nconst target = document.querySelector('#preview').contentWindow.document;\ntarget.open();\ntarget.write(response.html);\ntarget.close();\nevidence.textContent = 'Response field reached document.write';`
    if (value.includes('appendchild') || value.includes('contextualfragment')) return `${load};\noutput.appendChild(document.createRange().createContextualFragment(response.htmlFragment));\nevidence.textContent = 'Response fragment appended';`
    if (value.includes('domparser')) return `${load};\nconst mime = document.querySelector('#parser-mime')?.value || 'text/html';\nconst parsed = new DOMParser().parseFromString(response.html, mime);\noutput.replaceChildren(document.importNode(parsed.documentElement, true));\nevidence.textContent = 'Response HTML parsed for ' + mime;`
    if (value.includes('formaction')) return `${load};\ndocument.querySelector('#case-submit').formAction = response.formAction;\nevidence.textContent = 'Response field reached formAction';`
    if (value.includes('form.action')) return `${load};\ndocument.querySelector('#case-form').action = response.formAction;\nevidence.textContent = 'Response field reached form.action';`
    if (value.includes('submit form')) return `${load};\ndocument.querySelector('#case-form').action = response.formAction;\nevidence.textContent = 'Response-backed form prepared';\ndocument.querySelector('#case-form').requestSubmit();`
    return `${load};\noutput.innerHTML = response.html;\nevidence.textContent = 'Response field reached innerHTML';`
  }
  if (value.includes('iast_runtime')) {
    if (value.includes('insertadjacenthtml')) return `output.insertAdjacentHTML('beforeend', ${supplied});\nevidence.textContent = 'Runtime value inserted as HTML';`
    if (value.includes('inline event') || value.includes('onclick')) return `output.setAttribute('onclick', ${supplied});\noutput.click();\nevidence.textContent = 'Runtime value reached inline handler';`
    if (value.includes('javascript:')) return `document.querySelector('#case-link').href = 'javascript:' + ${supplied};\nevidence.textContent = 'Runtime value reached javascript URL';`
    if (value.includes('navigation target')) return `document.querySelector('#case-link').href = new URL('#' + encodeURIComponent(${supplied}), location.href).href;\nevidence.textContent = 'Runtime value reached navigation target';`
    return `output.innerHTML = ${supplied};\nevidence.textContent = 'Runtime value reached innerHTML';`
  }
  if (value.includes('dom_xss')) {
    if (value.includes('outerhtml')) return `output.outerHTML = '<div id="output">' + ${supplied} + '</div>';\nevidence.textContent = 'Value reached outerHTML';`
    if (value.includes('insertadjacenthtml')) return `output.insertAdjacentHTML('beforeend', ${supplied});\nevidence.textContent = 'Value reached insertAdjacentHTML';`
    if (value.includes('document.write')) return `const target = document.querySelector('#preview').contentWindow.document;\ntarget.open();\ntarget.write(${supplied});\ntarget.close();\nevidence.textContent = 'Value reached document.write';`
    if (value.includes('appendchild') || value.includes('contextualfragment')) return `const fragment = document.createRange().createContextualFragment(${supplied});\noutput.appendChild(fragment);\nevidence.textContent = 'Fragment appended';`
    if (value.includes('domparser')) return `const mime = document.querySelector('#parser-mime')?.value || 'text/html';\nconst parsed = new DOMParser().parseFromString(${supplied}, mime);\noutput.replaceChildren(document.importNode(parsed.documentElement, true));\nevidence.textContent = 'Parsed DOM appended for ' + mime;`
    if (value.includes('onclick') || value.includes('inline event')) return `output.setAttribute('onclick', ${supplied});\noutput.click();\nevidence.textContent = 'Inline handler assigned';`
    if (value.includes('srcdoc')) {
      if (value.includes('secondary_sources')) return `localStorage.setItem('ptkAtomicSecondaryHtml', ${supplied});\nconst secondaryValue = localStorage.getItem('ptkAtomicSecondaryHtml');\ndocument.querySelector('#preview').srcdoc = secondaryValue;\nevidence.textContent = 'localStorage value reached iframe.srcdoc';`
      return `document.querySelector('#preview').srcdoc = ${supplied};\nevidence.textContent = 'Value reached iframe.srcdoc';`
    }
    return `output.innerHTML = ${supplied};\nevidence.textContent = 'Value reached innerHTML';`
  }
  if (value.includes('dom_url_navigation') || value.includes('open_redirect') || value.includes('route_controlled_navigation') || value.includes('form_submission_hijack') || value.includes('form_submit_csrf')) {
    const destination = `new URL('#' + encodeURIComponent(${supplied}), location.href).href`
    if (value.includes('pushstate')) return `history.pushState({}, '', ${destination});\nevidence.textContent = 'Value reached history.pushState';`
    if (value.includes('replacestate')) return `history.replaceState({}, '', ${destination});\nevidence.textContent = 'Value reached history.replaceState';`
    if (value.includes('window.open')) return `window.open(${destination}, '_blank');\nevidence.textContent = 'Value reached window.open';`
    if (value.includes('anchor') || value.includes('href')) return `document.querySelector('#case-link').href = ${destination};\nevidence.textContent = 'Value reached href';`
    if (value.includes("setattribute('src'") || value.includes('iframe.src')) return `document.querySelector('#preview').src = ${destination};\nevidence.textContent = 'Value reached src';`
    if (value.includes('formaction')) return `document.querySelector('#case-submit').formAction = ${destination};\nevidence.textContent = 'Value reached submitter formAction';`
    if (value.includes('form.action') || value.includes('set form.action')) return `document.querySelector('#case-form').action = ${destination};\nevidence.textContent = 'Value reached form.action';`
    if (value.includes('submit')) return `document.querySelector('#case-form').action = ${destination};\nevidence.textContent = 'Value reached form submission';\ndocument.querySelector('#case-form').requestSubmit();`
    if (value.includes('replace')) return `location.replace(${destination});`
    if (value.includes('assign')) return `location.assign(${destination});`
    return `location.href = ${destination};`
  }
  if (value.includes('dynamic_script_loading')) return `const blob = new Blob([${supplied}], { type: 'application/javascript' });\nconst script = document.createElement('script');\nscript.src = URL.createObjectURL(blob);\ndocument.head.appendChild(script);\nevidence.textContent = 'Dynamic script appended';`
  if (value.includes('file_reader')) return `const file = new File([${supplied}], 'evidence.txt', { type: 'text/plain' });\nconst reader = new FileReader();\nreader.addEventListener('load', () => { output.innerHTML = String(reader.result); evidence.textContent = 'FileReader result rendered'; });\n${value.includes('dataurl') ? 'reader.readAsDataURL(file);' : value.includes('arraybuffer') ? 'reader.readAsArrayBuffer(file);' : 'reader.readAsText(file);'}`
  if (value.includes('iframe_navigation')) {
    if (value.includes('srcdoc')) return `document.querySelector('#preview').srcdoc = ${supplied};\nevidence.textContent = 'Value reached iframe.srcdoc';`
    return `document.querySelector('#preview').src = ${localUrl};\nevidence.textContent = 'Value reached iframe.src';`
  }
  if (value.includes('inbound_channel_trust') || value.includes('web_messaging_channels') || value.includes('postmessage_misuse')) {
    if (value.includes('broadcast')) return `const channel = new BroadcastChannel('ptk-atomic');\nchannel.addEventListener('message', (event) => { output.innerHTML = String(event.data); channel.close(); });\nchannel.postMessage(${supplied});\nevidence.textContent = 'Broadcast message sent';`
    if (value.includes('messageport') || value.includes('messagechannel')) return `const channel = new MessageChannel();\nchannel.port1.onmessage = (event) => eval(String(event.data));\nchannel.port2.postMessage(${supplied});\nevidence.textContent = 'MessagePort value evaluated';`
    if (value.includes('worker message')) return `const workerUrl = URL.createObjectURL(new Blob(["onmessage = (event) => postMessage(event.data)"], { type: 'application/javascript' }));\nconst worker = new Worker(workerUrl);\nworker.onmessage = (event) => { document.querySelector('#case-form').action = new URL('#' + encodeURIComponent(event.data), location.href).href; worker.terminate(); };\nworker.postMessage(${supplied});\nevidence.textContent = 'Worker message reached form.action';`
    return `window.postMessage(${supplied}, '*');\nevidence.textContent = 'Wildcard message sent';`
  }
  if (value.includes('indexeddb_cache_storage')) {
    if (value.includes('cache.match')) return `const cache = await caches.open('ptk-atomic');\nawait cache.put('./atomic-value', new Response(${supplied}));\nconst stored = await cache.match('./atomic-value');\nawait fetch(${localUrl} + '&stored=' + encodeURIComponent(await stored.text()));\nevidence.textContent = 'Cached value reused in request';`
    if (value.includes('cache.put')) return `const cache = await caches.open('ptk-atomic');\nawait cache.put('./atomic-value', new Response(${supplied}));\nevidence.textContent = 'Value stored in Cache Storage';`
    if (value.includes('get()')) return `const request = indexedDB.open('ptk-atomic', 1);\nrequest.onupgradeneeded = () => request.result.createObjectStore('values');\nrequest.onsuccess = () => { const tx = request.result.transaction('values', 'readwrite'); const store = tx.objectStore('values'); store.put(${supplied}, 'value'); tx.oncomplete = () => { const readTx = request.result.transaction('values'); const readRequest = readTx.objectStore('values').get('value'); readRequest.onsuccess = () => eval(String(readRequest.result)); }; evidence.textContent = 'IndexedDB value queued for eval'; };`
    return `const request = indexedDB.open('ptk-atomic', 1);\nrequest.onupgradeneeded = () => request.result.createObjectStore('values');\nrequest.onsuccess = () => { const tx = request.result.transaction('values', 'readwrite'); tx.objectStore('values').put(${supplied}, 'value'); evidence.textContent = 'Value stored in IndexedDB'; };`
  }
  if (value.includes('js_execution') || value.includes('storage_taint_to_exec') || value.includes('timer_js_execution')) {
    if (value.includes('settimeout')) return `setTimeout(${supplied}, 0);\nevidence.textContent = 'String timeout scheduled';`
    if (value.includes('setinterval')) return `const timer = setInterval(${supplied}, 100);\nsetTimeout(() => clearInterval(timer), 250);\nevidence.textContent = 'String interval scheduled';`
    if (value.includes('function')) return `new Function(${supplied})();\nevidence.textContent = 'Function constructor executed';`
    return `eval(${supplied});\nevidence.textContent = 'Value evaluated';`
  }
  if (value.includes('prototype_pollution_impact')) {
    if (value.includes('reflect.set')) return `const parsed = JSON.parse(${supplied});\nReflect.set({}, '__proto__', parsed.__proto__);\nevidence.textContent = 'Untrusted prototype value reached Reflect.set';`
    return `const parsed = JSON.parse(${supplied});\nObject.assign({}, parsed);\nevidence.textContent = 'Untrusted object merged';`
  }
  if (value.includes('realtime_exfiltration') || value.includes('websocket_url_poisoning')) return `const socketUrl = new URL('/passive/realtime/ws?value=' + encodeURIComponent(${supplied}), location.href);\nsocketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';\nconst socket = new WebSocket(socketUrl);\nsocket.addEventListener('open', () => { socket.send(${supplied}); socket.close(); });\nevidence.textContent = 'Value reached WebSocket';`
  if (value.includes('referrer_helper')) return `const link = document.querySelector('#case-link');\nlink.href = ${localUrl};\nlink.target = '_blank';\nlink.click();\nevidence.textContent = 'Same-origin child opened with referrer';`
  if (value.includes('storage_token_leaks')) {
    if (value.includes('sessionstorage')) return `sessionStorage.setItem('ptkAtomicLeak', ${supplied});\nevidence.textContent = 'Value written to sessionStorage';`
    if (value.includes('cookie')) return `document.cookie = ${supplied};\nevidence.textContent = 'Value written to cookie';`
    return `localStorage.setItem('ptkAtomicLeak', ${supplied});\nevidence.textContent = 'Value written to localStorage';`
  }
  if (value.includes('trusted_types_and_sanitizer')) {
    if (value.includes('dompurify')) return `const DOMPurify = { sanitize: (candidate) => candidate };\noutput.innerHTML = DOMPurify.sanitize(${supplied}, { ALLOW_UNKNOWN_PROTOCOLS: true });\nevidence.textContent = 'Permissive sanitizer result reached HTML sink';`
    if (value.includes('createhtml')) return `const policy = trustedTypes.createPolicy('ptk-html-' + Date.now(), { createHTML: (candidate) => candidate });\noutput.innerHTML = policy.createHTML(${supplied});\nevidence.textContent = 'Value reached TrustedHTML policy';`
    if (value.includes('createscripturl')) return `const policy = trustedTypes.createPolicy('ptk-url-' + Date.now(), { createScriptURL: (candidate) => candidate });\nconst script = document.createElement('script');\nscript.src = policy.createScriptURL(${supplied});\ndocument.head.appendChild(script);\nevidence.textContent = 'Value reached TrustedScriptURL policy';`
    return `const policy = trustedTypes.createPolicy('ptk-script-' + Date.now(), { createScript: (candidate) => candidate });\neval(String(policy.createScript(${supplied})));\nevidence.textContent = 'Value reached TrustedScript policy';`
  }
  if (value.includes('worker_script_loading')) return `const workerUrl = URL.createObjectURL(new Blob([${supplied}], { type: 'application/javascript' }));\nconst worker = new Worker(workerUrl);\nworker.terminate();\nevidence.textContent = 'Value reached worker script loading';`
  if (value.includes('xpath_injection')) return `document.evaluate(${supplied}, document, null, XPathResult.ANY_TYPE, null);\nevidence.textContent = 'Value reached XPath evaluator';`
  return `output.innerHTML = ${supplied};\nevidence.textContent = 'Value reached runtime boundary';`
}

function fixedOperation(entry) {
  const value = `${entry.sourcePath} ${entry.label}`.toLowerCase()
  if (value.includes('domparser')) {
    const source = value.includes('response_field_reachability')
      ? `const response = await fetch('./payload.json').then((result) => result.json());\nconst sourceValue = response.html`
      : `const sourceValue = input.value`
    return `${source};\nconst mime = document.querySelector('#parser-mime')?.value || 'text/html';\nconst cleanMarkup = mime === 'image/svg+xml' ? '<svg><text>Known safe markup</text></svg>' : '<p>Known safe markup</p>';\nnew DOMParser().parseFromString(cleanMarkup, mime);\noutput.textContent = sourceValue;\nevidence.textContent = 'Same parser invoked with constant markup; untrusted value stayed text';`
  }
  if (value.includes('srcdoc')) {
    if (value.includes('secondary_sources')) return `localStorage.setItem('ptkAtomicSecondaryHtml', input.value);\nconst secondaryValue = localStorage.getItem('ptkAtomicSecondaryHtml');\ndocument.querySelector('#preview').srcdoc = '<p data-ptk-control="constant">Known safe markup</p>';\noutput.textContent = secondaryValue;\nevidence.textContent = 'Same storage read preserved; iframe.srcdoc received constant markup';`
    return `document.querySelector('#preview').srcdoc = '<p data-ptk-control="constant">Known safe markup</p>';\noutput.textContent = input.value;\nevidence.textContent = 'Same iframe sink invoked with constant markup; untrusted value stayed text';`
  }
  if (/request|fetch|xhr|beacon|websocket|postmessage|navigation|redirect|action|href|src|worker|script|eval|function|timer|sql|xpath|document_domain|clipboard/.test(value)) {
    return `output.textContent = input.value;\nevidence.textContent = 'Untrusted value kept as data; executable, navigation and request boundaries use constants';`
  }
  if (/json|prototype/.test(value)) return `const parsed = JSON.parse(input.value);\nconst clean = Object.create(null);\nfor (const key of Object.keys(parsed)) if (!['__proto__', 'constructor', 'prototype'].includes(key)) clean[key] = parsed[key];\noutput.textContent = JSON.stringify(clean);\nevidence.textContent = 'Parsed object copied through an own-key allow-list';`
  if (/storage|cookie/.test(value)) return `output.textContent = input.value;\nlocalStorage.removeItem('ptkAtomicLeak');\nsessionStorage.removeItem('ptkAtomicLeak');\nevidence.textContent = 'Sensitive value not persisted';`
  return `output.textContent = input.value;\nevidence.textContent = 'Value displayed as literal text';`
}

function scriptFor(entry, variant) {
  const operationEntry = { ...entry, label: `${entry.anchor} ${entry.label}` }
  const operation = variant === 'review' ? reviewOperation(operationEntry) : fixedOperation(operationEntry)
  const value = `${entry.sourcePath} ${entry.anchor} ${entry.label}`.toLowerCase()
  const queryBacked = (value.includes('dom_parser_xss') || value.includes('iframe_navigation'))
    && !value.includes('response_field_reachability')
  const preparedValue = queryBacked
    ? `new URLSearchParams(location.search).get('value') || ${JSON.stringify(defaultValue(entry))}`
    : JSON.stringify(defaultValue(entry))
  return `const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = ${preparedValue}

document.querySelector('#run-case').addEventListener('click', async () => {
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
  const value = `${entry.sourcePath} ${entry.anchor} ${entry.label}`.toLowerCase()
  return {
    form: /formaction|form\.action|form submit|form_submission|form_submit|worker message/.test(value),
    link: /javascript:|navigation target|anchor|href|referrer_helper/.test(value),
    domParser: /domparser/.test(value),
    preview: (/blob_object_url/.test(value) && /iframe/.test(value))
      || /document\.write|srcdoc|iframe_navigation|iframe\.src|setattribute\(['"]src/.test(value)
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
<body class="target-page engine-page engine-page--iast">
  <a class="skip-link" href="#workbench">Skip to case</a>
  <header class="site-header atomic-site-header">
    <div class="site-header__inner">
      <a class="brand" href="${rootRoute('./')}"><span class="brand__mark" aria-hidden="true">PTK</span><span>OWASP PTK Playground</span></a>
      <nav class="site-nav" aria-label="Atomic target navigation"><a href="${rootRoute(entry.sourcePath)}">Case family</a><a href="${rootRoute('./explore/?engine=IAST')}">Explore IAST</a></nav>
    </div>
  </header>
  <main class="page-shell target-shell atomic-shell" data-atomic-iast-id="${htmlText(entry.id)}" data-operation-kind="${htmlText(entry.operationKind)}" data-variant="${variant}">
    <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${rootRoute('./')}">Playground</a><span aria-hidden="true">/</span><a href="${rootRoute('./iast/')}">IAST</a><span aria-hidden="true">/</span><a href="${rootRoute(entry.sourcePath)}">Case family</a><span aria-hidden="true">/</span><span>${stateLabel}</span></nav>
    <section class="atomic-hero atomic-hero--${variant}">
      <div class="atomic-hero__copy">
        <div class="atomic-kicker"><span class="atomic-engine-badge">IAST</span><span class="atomic-state-badge">${stateLabel}</span></div>
        <h1>${htmlText(title)}</h1>
        <p>${repaired ? 'The same prepared browser input and action are preserved without crossing the unsafe runtime boundary.' : 'A single live source-to-operation flow is isolated with deterministic input, action and visible evidence.'}</p>
      </div>
      <div class="atomic-hero__actions">
        <a class="button" href="${counterpartRoute}">${counterpartLabel}</a>
        <a class="button button--secondary" href="${rootRoute(entry.sourceRoute)}">Open Advanced source</a>
      </div>
    </section>

    <ol class="atomic-steps" aria-label="How to use this IAST case">
      <li><span>1</span><div><strong>Start IAST first</strong><p>Runtime hooks need to be active before you perform the prepared browser action.</p></div></li>
      <li><span>2</span><div><strong>Run the browser flow</strong><p>Review or edit the harmless input, then trigger this isolated operation once.</p></div></li>
      <li><span>3</span><div><strong>Compare the pair</strong><p>Open the ${repaired ? 'review target' : 'repaired control'} and repeat the same action to verify the runtime boundary.</p></div></li>
    </ol>

    <section id="workbench" class="atomic-workbench" aria-label="IAST scenario workbench">
      <article class="atomic-panel atomic-panel--input">
        <div class="atomic-panel__heading"><div><p class="eyebrow">Prepared flow</p><h2>Browser input and action</h2></div><span class="atomic-panel__step">01</span></div>
        <label class="atomic-field-label" for="case-input">Harmless runtime value</label>
        <textarea class="atomic-input" id="case-input" rows="4" spellcheck="false"></textarea>
${support.domParser ? `        <label class="atomic-field-label" for="parser-mime">Parser MIME type</label>
        <select class="atomic-input" id="parser-mime">
          <option value="text/html">text/html</option>
          <option value="application/xhtml+xml">application/xhtml+xml</option>
          <option value="image/svg+xml">image/svg+xml</option>
          <option value="text/plain">text/plain (unsupported control)</option>
        </select>` : ''}
        <p class="atomic-help">The value is intentionally visible and editable so the source-to-operation path can be reproduced without a destructive payload.</p>
        <form class="atomic-support-form" id="case-form" method="get" action="./" target="preview"${support.form ? '' : ' hidden'}>
          <input type="hidden" name="ptk" value="form-evidence">
          <button class="button button--secondary" id="case-submit" type="submit">Run prepared form action</button>
        </form>
        <div class="atomic-action-row"><button class="button" id="run-case" type="button">Run focused case</button><a class="button button--secondary" id="case-link" href="#output"${support.link ? '' : ' hidden'}>Open prepared link</a></div>
        <img class="visually-hidden" id="case-image" alt="" width="1" height="1">
      </article>

      <article class="atomic-panel atomic-panel--evidence">
        <div class="atomic-panel__heading"><div><p class="eyebrow">Runtime proof</p><h2>Visible evidence</h2></div><span class="atomic-panel__step">02</span></div>
        <div class="atomic-output" id="output" data-empty-label="The browser result will appear here."></div>
        <iframe class="atomic-preview" id="preview" name="preview" title="Runtime output preview"${support.preview ? '' : ' hidden'}></iframe>
        <p class="atomic-evidence-status" id="evidence" data-state="ready"><span aria-hidden="true"></span>Ready to run</p>
      </article>
    </section>

    <aside class="atomic-pair-note atomic-pair-note--${variant}">
      <div><p class="eyebrow">Paired verification</p><h2>${repaired ? 'Same action, controlled runtime boundary' : 'Prove the flow, then challenge it'}</h2><p>${repaired ? 'Use this page after the review target. The browser action remains available while untrusted input stays data.' : 'Repeat the same operation on the repaired control. A useful scanner should distinguish the unsafe flow from the behavior-preserving fix.'}</p></div>
      <a class="button button--secondary" href="${counterpartRoute}">${counterpartLabel}</a>
    </aside>
  </main>
  <footer class="site-footer"><div class="site-footer__inner"><p>IAST atomic target · scanner-neutral and locally reproducible.</p><nav aria-label="Project links"><a href="${rootRoute(entry.sourcePath)}">Case family</a><a href="${rootRoute('./explore/?engine=IAST')}">Explore IAST</a></nav></div></footer>
  <script src="./case.js"></script>
</body>
</html>
`
}

function write(relativePath, content) {
  if (relativePath.startsWith('atomic/iast/')) expectedGeneratedFiles.add(relativePath)
  const absolute = path.join(repoRoot, relativePath)
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) throw new Error(`${relativePath} is stale; run npm run catalog:generate`)
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

const entries = ledger.sources
  .filter((source) => source.role === 'legacy-aggregate' && source.path.startsWith('iast/'))
  .flatMap((source) => (source.scenarios || [])
    .filter((scenario) => scenario.role === 'assertion')
    .map((scenario) => {
      const canonicalPath = source.canonicalPath || source.path
      return {
        id: `iast.atomic.${slug(canonicalPath.replace(/\.html$/i, ''))}.${slug(scenario.id.split('.').at(-1))}`,
        title: scenario.label,
        label: scenario.label,
        anchor: scenario.anchor,
        sourceId: source.id,
        sourcePath: canonicalPath,
        sourceRoute: `${source.route}#${encodeURIComponent(scenario.anchor)}`,
        sourceScenarioId: scenario.id,
        operationKind: operationKind(canonicalPath, `${scenario.anchor} ${scenario.label}`),
        directory: `atomic/iast/${slug(canonicalPath.replace(/\.html$/i, ''))}/${slug(scenario.id.split('.').at(-1))}`
      }
    }))
  .sort((left, right) => left.id.localeCompare(right.id))

if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('duplicate atomic IAST id')
for (const entry of entries) {
  write(`${entry.directory}/review/index.html`, pageFor(entry, 'review'))
  write(`${entry.directory}/review/case.js`, scriptFor(entry, 'review'))
  write(`${entry.directory}/fixed/index.html`, pageFor(entry, 'fixed'))
  write(`${entry.directory}/fixed/case.js`, scriptFor(entry, 'fixed'))
  if (entry.sourcePath.includes('response_field_reachability')) {
    const payload = `${JSON.stringify({
      html: '<strong data-ptk-evidence="response">PTK response evidence</strong>',
      htmlFragment: '<em data-ptk-evidence="fragment">PTK response fragment</em>',
      formAction: './?ptk=response-form',
      formJavascriptAction: 'javascript:void(0)'
    }, null, 2)}\n`
    write(`${entry.directory}/review/payload.json`, payload)
    write(`${entry.directory}/fixed/payload.json`, payload)
  }
}

const document = {
  schema: 'owasp-ptk-playground-atomic-iast/v1',
  version: 1,
  generatedFrom: 'catalog/source-ledger.json',
  summary: { challenges: entries.length, pairedTargets: entries.length * 2 },
  challenges: entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    sourceId: entry.sourceId,
    sourcePath: entry.sourcePath,
    sourceRoute: entry.sourceRoute,
    sourceScenarioId: entry.sourceScenarioId,
    sourceAnchor: entry.anchor,
    operationKind: entry.operationKind,
    reviewRoute: `./${entry.directory}/review/`,
    repairedRoute: `./${entry.directory}/fixed/`
  }))
}
write('catalog/iast-atomic.json', `${JSON.stringify(document, null, 2)}\n`)
const actualGeneratedFiles = walk('atomic/iast').sort()
const expectedFiles = [...expectedGeneratedFiles].sort()
if (JSON.stringify(actualGeneratedFiles) !== JSON.stringify(expectedFiles)) throw new Error('atomic/iast contains stale or missing generated files')
console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', ...document.summary }))
