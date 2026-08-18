import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

const inventoryRoots = [
  'sast',
  'iast',
  'passive',
  'campaigns',
  'demo',
  'scanner',
  'play',
  'explore',
  'atomic',
  'targets',
  'assets/css',
  'assets/js',
  'assets/vendor'
]

const generatedFiles = {
  ledger: 'catalog/source-ledger.json',
  routes: 'catalog/legacy-routes.json'
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function readJsonIfPresent(relativePath) {
  const absolute = path.join(repoRoot, relativePath)
  return fs.existsSync(absolute) ? JSON.parse(fs.readFileSync(absolute, 'utf8')) : null
}

function walk(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory)
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name)
    return entry.isDirectory() ? walk(relative) : [relative]
  })
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex')
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/&(?:[a-z]+|#\d+);/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unnamed'
}

function stablePathId(relativePath) {
  const digest = crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 10)
  return `${slug(relativePath.replace(/\.html$/i, ''))}-${digest}`
}

function canonicalSourcePath(relativePath) {
  return relativePath.replace(/\.advanced\.html$/i, '.html')
}

function textContent(value) {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function attribute(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2] || null
}

function pageTitle(source, relativePath) {
  const heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return textContent(heading?.[1] || title?.[1] || path.basename(relativePath, path.extname(relativePath)))
}

function classifySource(relativePath) {
  const extension = path.extname(relativePath).toLowerCase()
  const basename = path.basename(relativePath)
  const isIndex = basename === 'index.html'

  if (relativePath.startsWith('assets/vendor/')) {
    return { role: 'dependency', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (relativePath === 'passive/server.mjs') {
    return { role: 'runtime', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (relativePath.startsWith('campaigns/')) {
    return { role: 'presentation', disposition: isIndex ? 'index-only' : 'helper-only', reviewStatus: 'reviewed' }
  }
  if (/^(?:demo|scanner|play|explore)\//.test(relativePath)) {
    return { role: 'presentation', disposition: isIndex ? 'index-only' : 'helper-only', reviewStatus: 'reviewed' }
  }
  if (relativePath.startsWith('atomic/')) {
    if (extension === '.html') {
      return { role: 'atomic-target', disposition: 'migrate-atomic', reviewStatus: 'reviewed' }
    }
    return { role: 'target-support', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (/^assets\/(?:css|js)\//.test(relativePath)) {
    return { role: 'presentation-support', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (relativePath.startsWith('targets/')) {
    if (extension === '.html') {
      return { role: 'atomic-target', disposition: 'migrate-atomic', reviewStatus: 'reviewed' }
    }
    return { role: 'target-support', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (/^(?:sast|iast)\/[^/]+\.advanced\.html$/i.test(relativePath)) {
    return { role: 'legacy-aggregate', disposition: 'retain-aggregate', reviewStatus: 'pending-manual' }
  }
  if (isIndex) {
    return { role: 'family-index', disposition: 'index-only', reviewStatus: 'reviewed' }
  }
  if (extension !== '.html') {
    return { role: 'case-support', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  if (relativePath.includes('/cases/') || /_minimal\.html$/i.test(relativePath)) {
    return { role: 'atomic-case', disposition: 'migrate-atomic', reviewStatus: 'reviewed' }
  }
  if (/^(?:sast|iast)\/[^/]+\.html$/i.test(relativePath)) {
    return { role: 'family-directory', disposition: 'index-only', reviewStatus: 'reviewed' }
  }
  if (relativePath === 'passive/header_disclosure_canary.html') {
    return { role: 'runtime-template', disposition: 'helper-only', reviewStatus: 'reviewed' }
  }
  return { role: 'legacy-aggregate', disposition: 'retain-aggregate', reviewStatus: 'pending-manual' }
}

function addCandidate(candidates, usedIds, baseId, candidate) {
  let id = `${baseId}.${slug(candidate.anchor || candidate.label || candidate.kind)}`
  let suffix = 2
  while (usedIds.has(id)) id = `${baseId}.${slug(candidate.anchor || candidate.label || candidate.kind)}-${suffix++}`
  usedIds.add(id)
  const value = { id, ...candidate }
  candidates.push(value)
  return value
}

function nearbyCaseLabel(source, offset, fallback) {
  const fragment = source.slice(offset, offset + 1800)
  const labelled = fragment.match(/<(?:h2|h3|h4|strong)\b[^>]*>([\s\S]*?)<\/(?:h2|h3|h4|strong)>/i)
  const metadata = fragment.match(/<[^>]*class\s*=\s*(["'])[^"']*\bcard-meta\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i)
  return textContent(metadata?.[2] || labelled?.[1] || fallback)
}

function interactionRole(label, kind) {
  if (kind === 'form') return 'helper'
  if (/\b(?:reset|clear|close|back|stop|after websocket close|clearinterval)\b/i.test(label)) return 'control'
  if (/\b(?:prime|seed|prepare|choose file|use same-origin url|use cross-origin url|use same-host ws url|use external ws url|load response payload|set demo hash payload|set hash payload|use field|use localstorage|use cookie)\b/i.test(label)) return 'setup'
  return 'assertion'
}

function elementEnd(source, start, tagName) {
  const token = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi')
  token.lastIndex = start
  let depth = 0
  for (let match = token.exec(source); match; match = token.exec(source)) {
    if (match.index === start || !match[0].startsWith('</')) depth += 1
    else depth -= 1
    if (depth === 0) return token.lastIndex
  }
  return source.length
}

function discoverHtmlScenarios(relativePath, source, classification) {
  if (!['legacy-aggregate', 'atomic-case', 'atomic-target'].includes(classification.role)) return []

  const baseId = `source.${stablePathId(canonicalSourcePath(relativePath))}`
  const candidates = []
  const usedIds = new Set()
  const caseContainers = []

  for (const match of source.matchAll(/<(div|article|section)\b([^>]*)>/gi)) {
    const tagName = match[1]
    const attributes = match[2]
    const id = attribute(attributes, 'id')
    const classes = attribute(attributes, 'class') || ''
    const severity = attribute(attributes, 'data-severity')
    if (!id || (!severity && !/(?:^|\s)(?:card|sink-block)(?:\s|$)/i.test(classes))) continue
    const label = nearbyCaseLabel(source, match.index, id)
    const role = /(?:safe|control|whitelist|repaired|fixed)/i.test(`${id} ${label}`) ? 'control' : 'assertion'
    const candidate = addCandidate(candidates, usedIds, baseId, {
      kind: 'case-container',
      role,
      anchor: id,
      locator: `#${id}`,
      label,
      ...(severity ? { severity } : {}),
      disposition: classification.role === 'legacy-aggregate' ? 'retain-aggregate' : 'migrate-atomic',
      reviewStatus: 'reviewed'
    })
    caseContainers.push({
      start: match.index,
      end: elementEnd(source, match.index, tagName),
      scenarioId: candidate.id,
      candidate,
      role
    })
  }

  let buttonIndex = 0
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    buttonIndex += 1
    const attributes = match[1]
    const id = attribute(attributes, 'id')
    const sink = attribute(attributes, 'data-sink')
    const action = attribute(attributes, 'data-ptk-action') || attribute(attributes, 'data-action')
    const severity = attribute(attributes, 'data-severity')
    const label = textContent(match[2]) || sink || action || id || `Button ${buttonIndex}`
    const anchor = sink || action || id || `button-${buttonIndex}-${slug(label)}`
    const role = interactionRole(label, 'button')
    const enclosingCase = caseContainers.find((container) => match.index > container.start && match.index < container.end)
    if (role === 'assertion' && enclosingCase && ['assertion', 'control'].includes(enclosingCase.role)) {
      enclosingCase.candidate.absorbedTriggers ||= []
      enclosingCase.candidate.absorbedTriggers.push({
        kind: 'button',
        anchor,
        locator: id ? `#${id}` : `button:nth-of-type(${buttonIndex})`,
        label,
        ...(severity ? { severity } : {}),
        reason: 'trigger-for-enclosing-case'
      })
      continue
    }
    addCandidate(candidates, usedIds, baseId, {
      kind: 'button',
      role,
      anchor,
      locator: id ? `#${id}` : `button:nth-of-type(${buttonIndex})`,
      label,
      ...(severity ? { severity } : {}),
      disposition: role === 'assertion'
        ? (classification.role === 'legacy-aggregate' ? 'retain-aggregate' : 'migrate-atomic')
        : 'helper-only',
      reviewStatus: 'reviewed'
    })
  }

  let formIndex = 0
  for (const match of source.matchAll(/<form\b([^>]*)>/gi)) {
    formIndex += 1
    const attributes = match[1]
    const id = attribute(attributes, 'id')
    const action = attribute(attributes, 'action')
    const anchor = id || `form-${formIndex}-${slug(action || 'submission')}`
    addCandidate(candidates, usedIds, baseId, {
      kind: 'form',
      role: 'helper',
      anchor,
      locator: id ? `#${id}` : `form:nth-of-type(${formIndex})`,
      label: id || action || `Form ${formIndex}`,
      disposition: 'helper-only',
      reviewStatus: 'reviewed'
    })
  }

  if (candidates.length === 0) {
    addCandidate(candidates, usedIds, baseId, {
      kind: 'page-static',
      role: 'assertion',
      anchor: 'page',
      locator: 'document',
      label: pageTitle(source, relativePath),
      disposition: classification.role === 'legacy-aggregate' ? 'retain-aggregate' : 'migrate-atomic',
      reviewStatus: 'reviewed'
    })
  }

  return candidates
}

function normalizeRoute(route) {
  if (typeof route !== 'string' || !route) return null
  const local = route.replace(/^\.\//, '/')
  if (!local.startsWith('/') || local.startsWith('//')) return null
  return new URL(local, 'http://playground.test').pathname
}

function routeForHtml(relativePath) {
  if (path.basename(relativePath) === 'index.html') {
    const directory = `/${path.posix.dirname(relativePath)}/`.replace(/^\/\.\//, '/').replace(/\/{2,}/g, '/')
    return directory
  }
  return `/${relativePath}`
}

const catalog = readJson('catalog/cases.json')
const missions = readJson('catalog/missions.json')
const demo = readJson('catalog/demo.json')
const scanner = readJson('catalog/scanner-targets.json')
const migratedScenarioIds = new Map()
for (const document of [readJsonIfPresent('catalog/sast-atomic.json'), readJsonIfPresent('catalog/iast-atomic.json')]) {
  for (const challenge of document?.challenges || []) {
    migratedScenarioIds.set(challenge.sourceScenarioId, challenge.id)
  }
}
const dastContracts = readJsonIfPresent('catalog/dast-contracts.json')
const dastChallengeIdsByRoute = new Map((dastContracts?.contracts || [])
  .filter((contract) => contract.disposition === 'security-target')
  .map((contract) => [contract.route, contract.id]))

const catalogIdsByPath = new Map()
for (const entry of catalog.cases) {
  const route = normalizeRoute(entry.route)
  if (!route) continue
  const relative = route.replace(/^\//, '')
  const ids = catalogIdsByPath.get(relative) || []
  ids.push(entry.id)
  catalogIdsByPath.set(relative, ids)
}

const runtimeCatalogSourceOverrides = {
  'passive.header-disclosure-present': 'passive/header_disclosure_canary.html',
  'passive.header-disclosure-control': 'passive/header_disclosure_canary.html',
  'passive.passive-fixtures-headers-weak-security': 'passive/headers_weak_security.html',
  'passive.passive-assets-client-config-js': 'passive/client_secrets.js',
  'passive.passive-fixtures-errors-stacktraces': 'passive/stacktrace_env_hints.html',
  'passive.passive-swagger-ui-index': 'passive/api_docs_graphql.html',
  'passive.well-known-openid-configuration': 'passive/server.mjs',
  'passive.passive-checkout-payment': 'passive/workflow_surfaces.html',
  'passive.orgs-acme-workspaces-red-team-settings': 'passive/tenant_boundary.html',
  'passive.passive-realtime-overview': 'passive/realtime_surfaces.html',
  'passive.wp-admin-index': 'passive/framework_surface.html',
  'passive.passive-fixtures-data-sensitive-data': 'passive/sensitive_data.html'
}
const runtimeSourceContractRoutes = {
  'passive/deserialization_indicator.html': ['/passive/fixtures/deser/indicator.html'],
  'passive/sourcemap_debug.html': ['/passive/debug/source-map.html', '/passive/assets/app.bundle.js.map'],
  'passive/token_param_surfaces.html': ['/passive/fixtures/tokens/index.html', '/passive/fixtures/tokens/jwt-url.html', '/passive/fixtures/tokens/url-leaks.html', '/passive/fixtures/params/high-risk.html']
}
for (const [caseId, relativePath] of Object.entries(runtimeCatalogSourceOverrides)) {
  const ids = catalogIdsByPath.get(relativePath) || []
  if (!ids.includes(caseId)) ids.push(caseId)
  catalogIdsByPath.set(relativePath, ids)
}

const sourcePaths = [...new Set(inventoryRoots.flatMap((root) => walk(root)))]
  .filter((relativePath) => !/(?:^|\/)\.DS_Store$/.test(relativePath))
  .sort()

const sources = sourcePaths.map((relativePath) => {
  const classification = classifySource(relativePath)
  const canonicalPath = canonicalSourcePath(relativePath)
  const source = path.extname(relativePath).toLowerCase() === '.html' ? read(relativePath) : null
  const scenarios = source ? discoverHtmlScenarios(relativePath, source, classification) : []
  for (const scenario of scenarios) {
    const atomicChallengeId = migratedScenarioIds.get(scenario.id)
    if (!atomicChallengeId) continue
    scenario.disposition = 'migrate-atomic'
    scenario.migrationStatus = 'implemented'
    scenario.atomicChallengeId = atomicChallengeId
  }
  if (relativePath.startsWith('passive/')) {
    const routes = [
      ...(catalogIdsByPath.get(relativePath) || []).map((caseId) => catalog.cases.find((entry) => entry.id === caseId)?.route).filter(Boolean),
      ...(runtimeSourceContractRoutes[relativePath] || [])
    ]
    const runtimeContractIds = [...new Set(routes.map((route) => dastChallengeIdsByRoute.get(route)).filter(Boolean))]
    if (runtimeContractIds.length) {
      for (const scenario of scenarios.filter((entry) => entry.role === 'assertion')) {
        scenario.disposition = 'migrate-atomic'
        scenario.migrationStatus = 'implemented'
        scenario.runtimeContractIds = runtimeContractIds
      }
    }
  }
  const reviewStatus = classification.role === 'legacy-aggregate' && scenarios.length > 0
    ? 'reviewed'
    : classification.reviewStatus
  const entry = {
    id: `file.${stablePathId(relativePath)}`,
    path: relativePath,
    ...(canonicalPath !== relativePath ? { canonicalPath } : {}),
    sha256: sha256(relativePath),
    role: classification.role,
    disposition: classification.disposition,
    reviewStatus
  }
  if (source) {
    entry.title = pageTitle(source, relativePath)
    entry.route = routeForHtml(relativePath)
  }
  if (classification.role !== 'family-directory' && catalogIdsByPath.has(canonicalPath)) {
    entry.catalogCaseIds = catalogIdsByPath.get(canonicalPath).sort()
  }
  if (scenarios.length) entry.scenarios = scenarios
  return entry
})

const routeConsumers = new Map()
function registerRoute(route, kind, owner) {
  const pathname = normalizeRoute(route)
  if (!pathname) return
  const existing = routeConsumers.get(pathname) || { path: pathname, kinds: new Set(), owners: new Set() }
  existing.kinds.add(kind)
  existing.owners.add(owner)
  routeConsumers.set(pathname, existing)
}

for (const source of sources) {
  if (source.route) {
    registerRoute(source.route, 'source', source.id)
    if (source.path.endsWith('/index.html')) registerRoute(`/${source.path}`, 'source-file', source.id)
  }
}
for (const entry of catalog.cases) registerRoute(entry.route, 'case-catalog', entry.id)
for (const mission of missions.missions) {
  registerRoute(mission.route, 'mission', mission.id)
  for (const target of Object.values(mission.targets || {})) registerRoute(target.route, 'mission-target', target.id)
}
for (const chapter of demo.chapters) registerRoute(missions.missions.find((mission) => mission.id === chapter.missionId)?.route, 'demo', chapter.id)
for (const mission of scanner.missions) {
  registerRoute(mission.route, 'scanner-mission', mission.id)
  for (const target of mission.targets) registerRoute(target.route, 'scanner-target', target.id)
}

const serverSource = read('passive/server.mjs')
const routeMapBody = serverSource.match(/const routeMap = new Map\(\[([\s\S]*?)\n\]\);/)?.[1] || ''
for (const match of routeMapBody.matchAll(/\[\s*"(\/[^"?]*)"\s*,/g)) registerRoute(match[1], 'route-aware-runtime', 'passive/server.mjs')
for (const route of [
  '/healthz',
  '/targets/session-bound-order-search/vulnerable/api/search',
  '/targets/session-bound-order-search/fixed/api/search',
  '/targets/history-order-router/vulnerable/api/order',
  '/targets/history-order-router/fixed/api/order',
  '/targets/same-origin-child-tab/vulnerable/api/context',
  '/targets/same-origin-child-tab/fixed/api/context',
  '/passive/realtime/ws'
]) registerRoute(route, 'route-aware-runtime', 'passive/server.mjs')

const legacyRoutes = [...routeConsumers.values()]
  .map((entry) => ({
    path: entry.path,
    kinds: [...entry.kinds].sort(),
    owners: [...entry.owners].sort()
  }))
  .sort((left, right) => left.path.localeCompare(right.path))

const roleCounts = Object.fromEntries([...new Set(sources.map((source) => source.role))]
  .sort()
  .map((role) => [role, sources.filter((source) => source.role === role).length]))
const reviewCounts = Object.fromEntries([...new Set(sources.map((source) => source.reviewStatus))]
  .sort()
  .map((status) => [status, sources.filter((source) => source.reviewStatus === status).length]))
const scenarioCounts = {
  total: sources.reduce((total, source) => total + (source.scenarios?.length || 0), 0),
  reviewed: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.reviewStatus === 'reviewed').length,
  pendingManual: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.reviewStatus === 'pending-manual').length,
  assertions: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.role === 'assertion').length,
  controls: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.role === 'control').length,
  setup: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.role === 'setup').length,
  helpers: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.role === 'helper').length,
  retainedAggregateAssertions: sources.flatMap((source) => source.scenarios || []).filter((scenario) => scenario.role === 'assertion' && scenario.disposition === 'retain-aggregate').length,
  absorbedTriggers: sources.flatMap((source) => source.scenarios || []).reduce((total, scenario) => total + (scenario.absorbedTriggers?.length || 0), 0)
}
scenarioCounts.reviewedMarkers = scenarioCounts.total + scenarioCounts.absorbedTriggers

const ledger = {
  schema: 'owasp-ptk-playground-source-ledger/v1',
  version: 1,
  referenceCorpus: {
    repository: 'https://github.com/ptklabs/ptk-playground.git',
    commit: '76cabc61a9552186588a6bf11a9ec680eea73e02'
  },
  inventoryRoots,
  summary: {
    sourceFiles: sources.length,
    authoredSourceFiles: sources.filter((source) => !source.path.startsWith('atomic/')).length,
    generatedAtomicFiles: sources.filter((source) => source.path.startsWith('atomic/')).length,
    roleCounts,
    reviewCounts,
    scenarios: scenarioCounts,
    migrationComplete: reviewCounts['pending-manual'] === undefined
      && scenarioCounts.pendingManual === 0
      && scenarioCounts.retainedAggregateAssertions === 0
  },
  sources
}

const routeInventory = {
  schema: 'owasp-ptk-playground-legacy-routes/v1',
  version: 1,
  summary: {
    routes: legacyRoutes.length,
    runtimeRoutes: legacyRoutes.filter((entry) => entry.kinds.includes('route-aware-runtime')).length
  },
  routes: legacyRoutes
}

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function publish(relativePath, value) {
  const output = serialized(value)
  const absolute = path.join(repoRoot, relativePath)
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== output) {
      throw new Error(`${relativePath} is stale; run npm run catalog:generate`)
    }
    return
  }
  fs.writeFileSync(absolute, output)
}

publish(generatedFiles.ledger, ledger)
publish(generatedFiles.routes, routeInventory)

console.log(JSON.stringify({
  mode: checkOnly ? 'check' : 'write',
  sources: ledger.summary.sourceFiles,
  scenarios: ledger.summary.scenarios,
  routes: routeInventory.summary
}))
