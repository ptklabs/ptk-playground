import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const catalog = readJson('catalog/cases.json')
const missions = readJson('catalog/missions.json')
const scannerTargets = readJson('catalog/scanner-targets.json')
const demo = readJson('catalog/demo.json')

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex')
}

test('public catalogue has unique, local, minimally valid cases', () => {
  assert.equal(catalog.schema, 'owasp-ptk-playground-catalog/v1')
  assert.equal(catalog.version, 1)
  assert.ok(Array.isArray(catalog.cases) && catalog.cases.length > 0)

  const ids = new Set()
  const engines = new Set(['sast', 'iast', 'dast-passive'])
  for (const entry of catalog.cases) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(entry.id.length > 3)
    assert.ok(!ids.has(entry.id), `duplicate case id: ${entry.id}`)
    ids.add(entry.id)
    assert.ok(engines.has(entry.engine), `unknown engine for ${entry.id}`)
    assert.ok(!Object.hasOwn(entry, 'edition'), `public case must not expose product edition: ${entry.id}`)
    assert.ok(Array.isArray(entry.mode) && entry.mode.length > 0, `missing mode for ${entry.id}`)
    assert.equal(typeof entry.route, 'string')
    assert.ok(entry.route.startsWith('./') || entry.route.startsWith('/'), `case route must be local: ${entry.id}`)
    assert.ok(!entry.route.startsWith('//'), `protocol-relative route is forbidden: ${entry.id}`)
  }
  for (const engine of engines) {
    assert.ok(catalog.cases.some((entry) => entry.engine === engine), `catalogue has no ${engine} cases`)
  }
})

test('public catalogue contains no executable PTK rulepack fields', () => {
  const forbidden = new Set([
    'attacks', 'rules', 'payloads', 'constants', 'validation', 'matcher', 'matchers',
    'execution', 'requestTemplate', 'requestTemplates', 'moduleId', 'ruleId', 'ruleIds',
    'policy', 'policyId', 'hookPolicy'
  ])
  function inspect(value, location = 'catalog') {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${location}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `forbidden public catalogue field ${location}.${key}`)
      inspect(entry, `${location}.${key}`)
    }
  }
  inspect(catalog)
  inspect(missions, 'missions')
  inspect(scannerTargets, 'scannerTargets')
  inspect(demo, 'demo')
})

test('curated demo references existing missions and covers every evidence family once as a coherent journey', () => {
  assert.equal(demo.schema, 'owasp-browser-security-demo/v1')
  assert.equal(demo.version, 1)
  assert.equal(demo.id, 'browser-context')
  assert.equal(demo.durationMinutes, 12)
  assert.equal(demo.chapters.length, 3)
  assert.deepEqual(demo.chapters.map((chapter) => chapter.missionId), [
    'support-widget',
    'session-bound-order-search',
    'transient-route-notice'
  ])
  assert.equal(demo.chapters.reduce((total, chapter) => total + chapter.durationMinutes, 0), demo.durationMinutes)

  const missionById = new Map(missions.missions.map((mission) => [mission.id, mission]))
  const coveredEngines = new Set()
  const chapterIds = new Set()
  for (const [index, chapter] of demo.chapters.entries()) {
    assert.equal(chapter.number, index + 1)
    assert.ok(chapter.id && !chapterIds.has(chapter.id), `duplicate demo chapter: ${chapter.id}`)
    chapterIds.add(chapter.id)
    const mission = missionById.get(chapter.missionId)
    assert.ok(mission, `demo references an unknown mission: ${chapter.missionId}`)
    mission.engines.forEach((engine) => coveredEngines.add(engine))
    assert.ok(Array.isArray(chapter.presenterSteps) && chapter.presenterSteps.length === 3)
    assert.ok(Array.isArray(chapter.evidence) && chapter.evidence.length > 0)
    assert.ok(chapter.browserAdvantage)
    const optionValues = chapter.checkpoint.options.map((option) => option.value)
    assert.equal(new Set(optionValues).size, optionValues.length)
    assert.ok(optionValues.includes(chapter.checkpoint.answer))
  }
  assert.deepEqual([...coveredEngines].sort(), ['DAST', 'IAST', 'SAST', 'SCA'])
  assert.doesNotMatch(JSON.stringify(demo), /moduleId|ruleId|payload|matcher|policyId|expectedFinding|findingCount/i)
})

test('scanner target catalogue is a minimal, exact projection of public missions', () => {
  const projected = missions.missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    summary: mission.summary,
    category: mission.category,
    engines: mission.engines,
    route: mission.route,
    targets: Object.entries(mission.targets).map(([variant, target]) => ({
      variant,
      id: target.id,
      title: target.title,
      route: target.route,
      displayRoute: target.displayRoute,
      visibleBehavior: target.visibleBehavior,
      ...(target.runtime ? { runtime: target.runtime } : {}),
      ...(target.request ? { request: target.request } : {}),
      ...(target.journey ? { journey: target.journey } : {}),
      ...(target.action ? { action: target.action } : {}),
      ...(mission.dependency ? {
        dependency: {
          name: mission.dependency.name,
          version: variant === 'review' ? mission.dependency.reviewVersion : mission.dependency.repairedVersion
        }
      } : {})
    }))
  }))

  assert.equal(scannerTargets.schema, 'owasp-browser-security-targets/v1')
  assert.equal(scannerTargets.version, 1)
  assert.deepEqual(scannerTargets.missions, projected)
  const serialized = JSON.stringify(scannerTargets)
  assert.doesNotMatch(serialized, /completion|objectives|answer|payload|matcher|ruleId|policyId/)
  assert.equal(scannerTargets.missions.reduce((total, mission) => total + mission.targets.length, 0), 16)
})

test('public mission catalogue is neutral, local and has paired target contracts', () => {
  assert.equal(missions.schema, 'owasp-browser-security-missions/v1')
  assert.equal(missions.version, 1)
  assert.ok(Array.isArray(missions.missions) && missions.missions.length > 0)
  const ids = new Set()
  const targetIds = new Set()
  const routeServer = read('passive/server.mjs')
  for (const mission of missions.missions) {
    assert.ok(mission.id && !ids.has(mission.id), `duplicate or missing mission id: ${mission.id}`)
    ids.add(mission.id)
    assert.deepEqual(mission.modes, ['campaign', 'explorer', 'demo', 'scanner'])
    assert.deepEqual(mission.objectives.map((objective) => objective.id), ['discover', 'prove', 'fix'])
    assert.ok(mission.route.startsWith('./') && !mission.route.startsWith('//'))
    for (const target of Object.values(mission.targets || {})) {
      assert.ok(target.id && !targetIds.has(target.id), `duplicate or missing mission target id: ${target.id}`)
      targetIds.add(target.id)
      assert.ok(target.route.startsWith('./') && !target.route.startsWith('//'))
      if (target.runtime?.kind === 'route-aware-server') {
        const pathname = new URL(target.route.replace(/^\.\//, '/'), 'http://playground.test').pathname
        assert.ok(routeServer.includes(`"${pathname}"`), `route server is missing mission target: ${pathname}`)
      } else {
        const relative = target.route.replace(/^\.\//, '')
        assert.ok(fs.existsSync(path.join(repoRoot, relative)), `missing mission target: ${relative}`)
      }
      if (target.source) {
        assert.ok(target.source.startsWith('./') && !target.source.startsWith('//'))
        const relativeSource = target.source.replace(/^\.\//, '')
        assert.ok(fs.existsSync(path.join(repoRoot, relativeSource)), `missing mission source: ${relativeSource}`)
      }
      if (target.action) {
        assert.match(target.action.triggerSelector, /^#[A-Za-z][\w-]*$/)
        assert.match(target.action.readySelector, /^#[A-Za-z][\w-]*$/)
        assert.ok(target.action.summary)
      }
    }
  }
})

test('public playground does not expose private product-tier terminology', () => {
  const publicFiles = [
    'README.md',
    'index.html',
    'sast/index.html',
    'iast/index.html',
    'passive/index.html',
    'catalog/cases.json',
    'catalog/missions.json',
    'catalog/scanner-targets.json',
    'catalog/demo.json',
    'campaigns/index.html',
    'demo/index.html',
    'scanner/index.html',
    ...missions.missions.map((mission) => `${mission.route.replace(/^\.\//, '')}index.html`),
    'assets/js/playground.js',
    'assets/css/playground.css'
  ]
  for (const file of publicFiles) {
    assert.doesNotMatch(read(file), /\bpro\b|portal/i, `${file} exposes private product-tier terminology`)
    assert.doesNotMatch(read(file), /"category"\s*:\s*"(?:free|full|base \+ full|free \+ full)"/i, `${file} exposes an internal edition as a category`)
  }

  for (const file of walk(repoRoot).filter((entry) => entry.endsWith('.html'))) {
    const visibleMarkup = fs.readFileSync(file, 'utf8')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    assert.doesNotMatch(
      visibleMarkup,
      /\bpro\b|\bportal\s+(?:rulepack|rules?|modules?|edition)\b/i,
      `${path.relative(repoRoot, file)} exposes private product-tier terminology in visible text`
    )
  }
})

test('catalogue routes resolve to static fixtures or passive server routes', () => {
  const passiveServer = read('passive/server.mjs')
  for (const entry of catalog.cases) {
    if (entry.engine === 'dast-passive') {
      const pathname = new URL(entry.route, 'http://playground.test').pathname
      assert.ok(passiveServer.includes(`"${pathname}"`), `passive route is not served: ${entry.id} ${pathname}`)
      continue
    }
    const relative = entry.route.replace(/^\.\//, '')
    assert.ok(fs.existsSync(path.join(repoRoot, relative)), `missing static case: ${entry.id} ${relative}`)
  }
})

test('public index pages use the shared self-hosted shell', () => {
  const pages = [
    'index.html',
    'sast/index.html',
    'iast/index.html',
    'passive/index.html',
    'campaigns/index.html',
    'demo/index.html',
    'scanner/index.html',
    ...missions.missions.map((mission) => `${mission.route.replace(/^\.\//, '')}index.html`)
  ]
  for (const page of pages) {
    const html = read(page)
    assert.match(html, /assets\/css\/playground\.css/)
    assert.match(html, /assets\/js\/playground\.js/)
    assert.match(html, /<main\b/)
    assert.match(html, /authorised/i)
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, `${page} must not execute remote scripts`)
    assert.doesNotMatch(html, /<link[^>]+href=["']https?:\/\//i, `${page} must not load remote styles`)
  }
  assert.doesNotMatch(read('assets/js/playground.js'), /\.innerHTML\s*=/, 'catalogue renderer must not reinterpret text as HTML')
  assert.match(read('demo/index.html'), /data-page="demo"/)
  assert.match(read('index.html'), /href="\.\/demo\/"/)
  for (const mission of missions.missions) {
    assert.match(read(`${mission.route.replace(/^\.\//, '')}index.html`), /href="\.\.\/\.\.\/demo\/"/)
  }
})

test('fixture markup has no duplicate static element IDs', () => {
  const htmlFiles = walk(repoRoot).filter((file) => file.endsWith('.html'))
  const duplicates = []
  for (const file of htmlFiles) {
    const markup = fs.readFileSync(file, 'utf8')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    const ids = [...markup.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1])
    const seen = new Set()
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(`${path.relative(repoRoot, file)}#${id}`)
      seen.add(id)
    }
  }
  assert.deepEqual(duplicates, [])
})

test('known legacy remote fixture dependencies are bounded and cannot grow silently', () => {
  const known = new Set([
    'sast/ajax_request_header.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/client_template_injection.html|https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.13.6/underscore-min.js',
    'sast/dom_selector.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/javascript_injection_taint.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/link_manipulation.html|https://code.jquery.com/jquery-3.7.1.min.js'
  ])
  const actual = new Set()
  for (const file of walk(repoRoot).filter((entry) => entry.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8')
    for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)) {
      actual.add(`${path.relative(repoRoot, file)}|${match[1]}`)
    }
  }
  assert.deepEqual([...actual].sort(), [...known].sort())
})

test('the local AngularJS canary dependency is pinned with its upstream license', () => {
  const source = readJson('assets/vendor/angularjs/SOURCE.json')
  assert.equal(source.package, 'angular')
  assert.equal(source.version, '1.8.3')
  assert.equal(source.license, 'MIT')
  for (const [file, expectedHash] of Object.entries(source.files || {})) {
    assert.equal(sha256(`assets/vendor/angularjs/${file}`), expectedHash, `${file} does not match its recorded upstream hash`)
  }
  assert.match(read('assets/vendor/angularjs/LICENSE.md'), /MIT License/i)
})

test('the support-widget dependency pair is pinned locally with source hashes and licence', () => {
  const source = readJson('assets/vendor/jquery/SOURCE.json')
  assert.equal(source.package, 'jquery')
  assert.equal(source.license, 'MIT')
  assert.equal(source.files['jquery-3.4.1.min.js'].version, '3.4.1')
  assert.equal(source.files['jquery-3.7.1.min.js'].version, '3.7.1')
  for (const [file, metadata] of Object.entries(source.files || {})) {
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/)
    assert.equal(sha256(`assets/vendor/jquery/${file}`), metadata.sha256, `${file} does not match its recorded upstream hash`)
  }
  assert.match(read('assets/vendor/jquery/LICENSE.txt'), /permission is hereby granted/i)
})

test('support-widget campaign state and target evidence remain isolated', () => {
  const shell = read('campaigns/support-widget/index.html')
  const sharedScript = read('assets/js/playground.js')
  const vulnerablePage = read('targets/support-widget/vulnerable/index.html')
  const fixedPage = read('targets/support-widget/fixed/index.html')
  const vulnerableScript = read('targets/support-widget/vulnerable/widget.js')
  const fixedScript = read('targets/support-widget/fixed/widget.js')

  assert.match(shell, /assets\/js\/playground\.js/)
  assert.doesNotMatch(shell, /jquery-3\.(?:4\.1|7\.1)|targets\/support-widget\/(?:vulnerable|fixed)\/widget\.js/)
  assert.match(sharedScript, /owasp-browser-security-campaign\/v1:/)

  for (const [name, page] of [['vulnerable', vulnerablePage], ['fixed', fixedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} target imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} target executes a remote script`)
  }
  for (const [name, source] of [['vulnerable', vulnerableScript], ['fixed', fixedScript]]) {
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT/i, `${name} script reads campaign or extension state`)
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i, `${name} script performs a network request`)
  }

  assert.match(vulnerablePage, /jquery-3\.4\.1\.min\.js/)
  assert.match(fixedPage, /jquery-3\.7\.1\.min\.js/)
  assert.match(vulnerableScript, /\.html\(message\.html\)/)
  assert.doesNotMatch(vulnerableScript, /event\.origin\s*[!=]==?/)
  assert.match(fixedScript, /event\.origin\s*!==\s*SUPPORT_ORIGIN/)
  assert.match(fixedScript, /typeof event\.data !== "string"/)
  assert.match(fixedScript, /const message = \{ type: "support:reply", text: event\.data \}/)
  assert.match(fixedScript, /\.textContent\s*=\s*message\.text/)
  assert.doesNotMatch(fixedScript, /\.html\s*\(|\.innerHTML\s*=/)
})

test('deployment response mission keeps gameplay out of its route-aware target', () => {
  const shell = read('campaigns/deployment-response-boundary/index.html')
  const targetPage = read('passive/header_disclosure_canary.html')
  const targetScript = read('passive/header_disclosure_canary.js')

  assert.match(shell, /data-mission-id="deployment-response-boundary"/)
  assert.doesNotMatch(targetPage, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetScript, /sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetPage, /<script[^>]+src=["']https?:\/\//i)
  assert.match(targetScript, /response\.headers\.has\('x-powered-by'\)/)
  assert.match(targetScript, /RESPONSE-METADATA-DISCLOSED/)
  assert.match(targetScript, /RESPONSE-METADATA-CLEAN/)
})

test('session-bound order-search mission keeps active DAST traffic isolated and bounded', () => {
  const publicMission = missions.missions.find((entry) => entry.id === 'session-bound-order-search')
  const shell = read('campaigns/session-bound-order-search/index.html')
  const targetPage = read('targets/session-bound-order-search/index.html')
  const targetScript = read('targets/session-bound-order-search/order-search.js')
  const routeServer = read('passive/server.mjs')
  const orderSearchHandler = routeServer.slice(
    routeServer.indexOf('async function serveOrderSearchApi'),
    routeServer.indexOf('function handleUpgrade')
  )

  assert.match(shell, /data-mission-id="session-bound-order-search"/)
  assert.doesNotMatch(targetPage, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetScript, /sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetPage, /<script[^>]+src=["']https?:\/\//i)
  assert.match(targetScript, /new URL\('\.\/api\/search', window\.location\.href\)/)
  assert.match(targetScript, /credentials:\s*'same-origin'/)
  assert.match(targetScript, /result\.textContent\s*=/)
  assert.doesNotMatch(targetScript, /\.innerHTML\s*=/)

  assert.match(orderSearchHandler, /if \(!isHttps\)/)
  assert.match(orderSearchHandler, /req\.method !== "POST"/)
  assert.match(orderSearchHandler, /ptk_order_session=active/)
  assert.match(orderSearchHandler, /x-playground-request/)
  assert.match(orderSearchHandler, /readBoundedBody\(req\)/)
  assert.match(orderSearchHandler, /query\.length > 256/)
  assert.match(orderSearchHandler, /message:\s*"You have an error in your SQL syntax near the order search value"/)
  assert.doesNotMatch(orderSearchHandler, /message:\s*query\s*[,}]|JSON\.stringify\([^\n]*query/)

  for (const target of Object.values(publicMission.targets)) {
    assert.deepEqual(Object.keys(target.request).sort(), ['contentType', 'method', 'parameterNames', 'route', 'setup'])
    assert.deepEqual(target.request.parameterNames, ['query'])
    assert.ok(!Object.hasOwn(target.request, 'payload'))
    assert.ok(!Object.hasOwn(target.request, 'headers'))
  }
})

test('on-demand analytics mission loads only its pinned same-origin dependency after action', () => {
  const mission = missions.missions.find((entry) => entry.id === 'on-demand-analytics')
  const reviewPage = read('targets/on-demand-analytics/vulnerable/index.html')
  const repairedPage = read('targets/on-demand-analytics/fixed/index.html')
  const loader = read('targets/on-demand-analytics/analytics-loader.js')

  assert.match(read('campaigns/on-demand-analytics/index.html'), /data-mission-id="on-demand-analytics"/)
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.match(page, /\.\.\/analytics-loader\.js/)
    assert.doesNotMatch(page, /jquery-3\.(?:4\.1|7\.1)\.min\.js/, `${name} page eagerly loads the dependency`)
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i)
  }
  assert.match(loader, /loadButton\?\.addEventListener\('click'/)
  assert.match(loader, /jquery-3\.4\.1\.min\.js/)
  assert.match(loader, /jquery-3\.7\.1\.min\.js/)
  assert.match(loader, /new URL\(dependencyPath, import\.meta\.url\)/)
  assert.match(loader, /document\.head\.append\(dependency\)/)
  assert.match(loader, /window\.jQuery\(summary\)\.text\(/)
  assert.doesNotMatch(loader, /\.innerHTML\s*=|sessionStorage|localStorage|PTK_AGENT|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i)
  assert.equal(mission.dependency.reviewVersion, '3.4.1')
  assert.equal(mission.dependency.repairedVersion, '3.7.1')
})

test('saved-workspace mission preserves a two-document storage journey and strict repaired sink', () => {
  const mission = missions.missions.find((entry) => entry.id === 'saved-workspace')
  const editor = read('targets/saved-workspace/workspace-editor.js')
  const reviewPage = read('targets/saved-workspace/vulnerable/index.html')
  const reviewDashboard = read('targets/saved-workspace/vulnerable/dashboard.html')
  const reviewSource = read('targets/saved-workspace/vulnerable/dashboard.js')
  const repairedPage = read('targets/saved-workspace/fixed/index.html')
  const repairedDashboard = read('targets/saved-workspace/fixed/dashboard.html')
  const repairedSource = read('targets/saved-workspace/fixed/dashboard.js')

  assert.ok(mission)
  assert.match(read('campaigns/saved-workspace/index.html'), /data-mission-id="saved-workspace"/)
  assert.match(editor, /localStorage\.setItem\(storageKey, announcement\.value\)/)
  assert.match(editor, /window\.location\.assign\(new URL\('\.\/dashboard\.html'/)
  assert.doesNotMatch(editor, /innerHTML|outerHTML|document\.write/)

  for (const [name, page] of [
    ['review setup', reviewPage],
    ['review dashboard', reviewDashboard],
    ['repaired setup', repairedPage],
    ['repaired dashboard', repairedDashboard]
  ]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  assert.match(reviewSource, /localStorage\.getItem\(STORAGE_KEY\)/)
  assert.match(reviewSource, /preview\.innerHTML\s*=\s*savedAnnouncement/)
  assert.match(repairedSource, /localStorage\.getItem\(STORAGE_KEY\)/)
  assert.match(repairedSource, /preview\.textContent\s*=\s*savedAnnouncement/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write/)
  assert.doesNotMatch(`${editor}\n${reviewSource}\n${repairedSource}`, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|PTK_AGENT/i)
  assert.notEqual(
    reviewPage.match(/data-storage-key="([^"]+)"/)?.[1],
    repairedPage.match(/data-storage-key="([^"]+)"/)?.[1]
  )

  for (const target of Object.values(mission.targets)) {
    assert.ok(target.journey)
    assert.equal(target.journey.entrySelector, '#save-announcement')
    assert.equal(target.journey.childReadySelector, '#announcement-status')
    assert.ok(target.journey.childRoute.startsWith('/targets/saved-workspace/'))
    assert.ok(fs.existsSync(path.join(repoRoot, target.journey.childRoute.slice(1))))
  }
})

test('live-profile-preview mission preserves one action-loaded response and a strict text control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'live-profile-preview')
  const response = read('targets/live-profile-preview/profile.json')
  const reviewPage = read('targets/live-profile-preview/vulnerable/index.html')
  const reviewSource = read('targets/live-profile-preview/vulnerable/profile-preview.js')
  const repairedPage = read('targets/live-profile-preview/fixed/index.html')
  const repairedSource = read('targets/live-profile-preview/fixed/profile-preview.js')

  assert.ok(mission)
  assert.match(read('campaigns/live-profile-preview/index.html'), /data-mission-id="live-profile-preview"/)
  assert.deepEqual(JSON.parse(response), {
    displayName: 'Avery Morgan',
    summaryHtml: '<mark data-profile-proof="true">Priority customer profile</mark>',
    lastUpdated: '2026-08-13'
  })
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /fetch\('\.\.\/profile\.json'/, `${name} does not request the shared profile response`)
    assert.match(source, /credentials:\s*'omit'/)
    assert.match(source, /setTimeout\(resolve, 250\)/, `${name} does not preserve the deferred UI-render boundary`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /preview\.innerHTML\s*=\s*profile\.summaryHtml/)
  assert.match(repairedSource, /preview\.textContent\s*=\s*profile\.summaryHtml/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write|insertAdjacentHTML/)
  for (const target of Object.values(mission.targets)) {
    assert.deepEqual(Object.keys(target.action).sort(), ['readySelector', 'summary', 'triggerSelector'])
    assert.equal(target.action.triggerSelector, '#load-profile')
    assert.equal(target.action.readySelector, '#profile-status')
  }
})

test('transient-route-notice mission preserves one short SPA route action and a non-reflecting control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'transient-route-notice')
  const reviewPage = read('targets/transient-route-notice/vulnerable/index.html')
  const reviewSource = read('targets/transient-route-notice/vulnerable/route-notice.js')
  const repairedPage = read('targets/transient-route-notice/fixed/index.html')
  const repairedSource = read('targets/transient-route-notice/fixed/route-notice.js')

  assert.ok(mission)
  assert.deepEqual(mission.engines, ['DAST', 'SAST', 'IAST'])
  assert.match(read('campaigns/transient-route-notice/index.html'), /data-mission-id="transient-route-notice"/)
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /window\.location\.hash\.split\('\?'\)/, `${name} does not read the hash-query route`)
    assert.match(source, /window\.location\.hash\s*=\s*`#\/incidents\?notice=/, `${name} does not preserve the route action`)
    assert.match(source, /}, 30\)/, `${name} does not preserve the 30 ms expiry boundary`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /notice\.innerHTML\s*=\s*routeNotice/)
  assert.match(repairedSource, /notice\.textContent\s*=\s*acceptedNotices\.get\(routeNotice\)\s*\|\|/)
  assert.match(repairedSource, /acceptedNotices\.has\(routeNotice\)/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write|insertAdjacentHTML/)
  for (const target of Object.values(mission.targets)) {
    assert.equal(target.action.triggerSelector, '#open-route-notice')
    assert.equal(target.action.readySelector, '#route-status')
  }
})

test('imported-request-preferences mission preserves one local request and rejects inherited options in its control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'imported-request-preferences')
  const response = read('targets/imported-request-preferences/preview.json')
  const reviewPage = read('targets/imported-request-preferences/vulnerable/index.html')
  const reviewSource = read('targets/imported-request-preferences/vulnerable/request-preferences.js')
  const repairedPage = read('targets/imported-request-preferences/fixed/index.html')
  const repairedSource = read('targets/imported-request-preferences/fixed/request-preferences.js')

  assert.ok(mission)
  assert.deepEqual(mission.engines, ['SAST', 'IAST'])
  assert.match(read('campaigns/imported-request-preferences/index.html'), /data-mission-id="imported-request-preferences"/)
  assert.deepEqual(JSON.parse(response), {
    message: 'Account preview loaded from the same-origin fixture.'
  })
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.match(page, /\{"__proto__":\{"credentials":"include"\}\}/, `${name} does not preserve the prepared input`)
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /JSON\.parse\(input\.value\)/, `${name} does not parse the shared input`)
    assert.match(source, /fetch\('\.\.\/preview\.json', requestOptions\)/, `${name} does not preserve the local request`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /Object\.assign\(\{\}, imported\)/)
  assert.match(reviewSource, /!hasOwnCredentials && requestOptions\.credentials === 'include'/)
  assert.doesNotMatch(reviewSource, /Object\.prototype\.(?:credentials|mode|headers)\s*=/)
  assert.match(repairedSource, /Object\.create\(null\)/)
  assert.match(repairedSource, /hasOwnProperty\.call\(imported, 'credentials'\)/)
  assert.match(repairedSource, /imported\.credentials === 'omit'/)
  assert.doesNotMatch(repairedSource, /Object\.assign|setPrototypeOf|Reflect\.set|\.__proto__\s*=|Object\.prototype\.[A-Za-z_$][\w$]*\s*=/)
  for (const target of Object.values(mission.targets)) {
    assert.equal(target.action.triggerSelector, '#import-preferences')
    assert.equal(target.action.readySelector, '#preferences-status')
  }
})

test('catalogue renderer does not expose passive localhost links in catalogue mode', () => {
  const source = read('assets/js/playground.js')
  assert.match(source, /if \(!passiveStatus\) return null/)
  assert.match(source, /Start local server/)
  assert.doesNotMatch(read('passive/index.html'), /href=["']https?:\/\/localhost:/i)
})

test('route-aware passive server serves the shared playground shell and catalogue', () => {
  const source = read('passive/server.mjs')
  for (const route of [
    '/assets/css/playground.css',
    '/assets/js/playground.js',
    '/catalog/cases.json',
    '/catalog/missions.json',
    '/catalog/scanner-targets.json',
    '/catalog/demo.json',
    '/demo/',
    '/scanner/',
    '/campaigns/deployment-response-boundary/',
    '/campaigns/session-bound-order-search/',
    '/campaigns/on-demand-analytics/',
    '/campaigns/saved-workspace/',
    '/campaigns/live-profile-preview/',
    '/campaigns/transient-route-notice/',
    '/campaigns/imported-request-preferences/',
    '/targets/support-widget/vulnerable/',
    '/targets/support-widget/fixed/',
    '/targets/on-demand-analytics/vulnerable/',
    '/targets/on-demand-analytics/fixed/',
    '/targets/saved-workspace/vulnerable/',
    '/targets/saved-workspace/vulnerable/dashboard.html',
    '/targets/saved-workspace/fixed/',
    '/targets/saved-workspace/fixed/dashboard.html',
    '/targets/live-profile-preview/profile.json',
    '/targets/live-profile-preview/vulnerable/',
    '/targets/live-profile-preview/vulnerable/profile-preview.js',
    '/targets/live-profile-preview/fixed/',
    '/targets/live-profile-preview/fixed/profile-preview.js',
    '/targets/transient-route-notice/vulnerable/',
    '/targets/transient-route-notice/vulnerable/route-notice.js',
    '/targets/transient-route-notice/fixed/',
    '/targets/transient-route-notice/fixed/route-notice.js',
    '/targets/imported-request-preferences/preview.json',
    '/targets/imported-request-preferences/vulnerable/',
    '/targets/imported-request-preferences/vulnerable/request-preferences.js',
    '/targets/imported-request-preferences/fixed/',
    '/targets/imported-request-preferences/fixed/request-preferences.js',
    '/targets/session-bound-order-search/vulnerable/',
    '/targets/session-bound-order-search/fixed/',
    '/targets/session-bound-order-search/order-search.js',
    '/passive/assets/header-disclosure-canary.js'
  ]) {
    assert.ok(source.includes(`"${route}"`), `passive server is missing ${route}`)
  }
})
