import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
const routes = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/legacy-routes.json'), 'utf8')).routes
const catalogCases = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/cases.json'), 'utf8')).cases
const catalogDastRoutes = new Set(catalogCases.filter((entry) => entry.engine === 'dast-passive').map((entry) => entry.route))

function slug(value) {
  const base = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'root'
  const digest = crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8)
  return `${base}-${digest}`
}

const securityRoutes = new Set([
  '/.well-known/assetlinks.json',
  '/.well-known/change-password',
  '/.well-known/jwks.json',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/.well-known/security.txt',
  '/humans.txt',
  '/robots.txt',
  '/socket.io/',
  '/sockjs/echo',
  '/support/tickets/create',
  '/switch-tenant'
])

function isSecurityTarget(pathname) {
  if (/^\/api\/labs\/graphql\/(?:vulnerable|fixed)$/.test(pathname)) return true
  if (/^\/api\/labs\/(?:idor-(?:read|write)\/(?:vulnerable|fixed)\/objects\/order-bob|jwt\/nested\/(?:vulnerable|fixed)\/admin)$/.test(pathname)) return true
  if (catalogDastRoutes.has(pathname)) return true
  if (securityRoutes.has(pathname)) return true
  if (/^\/targets\/session-bound-order-search\/(?:vulnerable|fixed)\/api\/search$/.test(pathname)) return true
  if (/^\/targets\/history-order-router\/(?:vulnerable|fixed)\/api\/order$/.test(pathname)) return true
  if (/^\/targets\/same-origin-child-tab\/(?:vulnerable|fixed)\/api\/context$/.test(pathname)) return true
  if (/^\/targets\/jwt-lab\/(?:authorization|cookie|form|json)\/(?:vulnerable|fixed)\/api\/session$/.test(pathname)) return true
  if (pathname.startsWith('/jwt/') || pathname.startsWith('/targets/jwt-lab/dast/')) return false
  if (!pathname.startsWith('/passive/')) return false
  return ![
    '/passive/',
    '/passive/index.html',
    '/passive/css/index.css',
    '/passive/assets/header-disclosure-canary.js',
    '/passive/header_disclosure_canary.html'
  ].includes(pathname)
}

function category(pathname) {
  if (pathname.includes('/api/labs/graphql/')) return 'GraphQL object authorization'
  if (pathname.includes('/api/labs/idor-')) return 'Authenticated object authorization'
  if (pathname.includes('/api/labs/jwt/nested/')) return 'JWT nested JSON authorization'
  if (pathname.includes('/targets/jwt-lab/')) return 'JWT request carrier and verification'
  if (pathname.includes('/api/search')) return 'Authenticated active request'
  if (pathname.includes('/api/order')) return 'SPA-created authenticated active request'
  if (pathname.includes('/api/context')) return 'Related child response evidence'
  if (/headers|powered-by/.test(pathname)) return 'HTTP response headers'
  if (/stacktrace|source-map|app\.bundle|client-config|debug/.test(pathname)) return 'Debug and client disclosure'
  if (/swagger|openapi|postman|graphql|graphiql|redoc|well-known/.test(pathname)) return 'API and platform discovery'
  if (/realtime|socket\.io|sockjs/.test(pathname)) return 'Realtime protocol surface'
  if (/token|jwt|sensitive|params|deser/.test(pathname)) return 'Sensitive data and input surface'
  if (/upload|download|files|checkout|support|tenant/.test(pathname)) return 'Application workflow surface'
  return 'Known deployment resource'
}

function evidence(pathname) {
  if (pathname.includes('/api/labs/graphql/')) return 'same-session-graphql-order-differential'
  if (pathname.includes('/api/labs/idor-')) return 'cross-owner-request-differential'
  if (pathname.includes('/api/labs/jwt/nested/')) return 'signed-jwt-request-differential'
  if (pathname.includes('/targets/jwt-lab/')) return 'jwt-request-differential'
  if (pathname.includes('/api/search')) return 'bounded-active-request'
  if (pathname.includes('/api/order')) return 'bounded-json-active-request'
  if (pathname.includes('/api/context')) return 'child-response-metadata'
  if (/realtime\/ws|socket\.io|sockjs/.test(pathname)) return 'websocket-upgrade'
  if (/headers|powered-by/.test(pathname)) return 'response-metadata'
  if (/\.js(?:\.map)?$|\.json$|\.ya?ml$|\.txt$|\.csv$|\.dump$/.test(pathname)) return 'response-resource'
  return 'browser-response'
}

const controlFor = new Map([
  ['/api/labs/graphql/vulnerable', '/api/labs/graphql/fixed'],
  ['/api/labs/idor-read/vulnerable/objects/order-bob', '/api/labs/idor-read/fixed/objects/order-bob'],
  ['/api/labs/idor-write/vulnerable/objects/order-bob', '/api/labs/idor-write/fixed/objects/order-bob'],
  ['/api/labs/jwt/nested/vulnerable/admin', '/api/labs/jwt/nested/fixed/admin'],
  ['/passive/cases/headers/powered-by.html', '/passive/cases/headers/secure-control.html'],
  ['/passive/fixtures/headers/weak-security.html', '/passive/fixtures/headers/secure-control.html'],
  ['/targets/session-bound-order-search/vulnerable/api/search', '/targets/session-bound-order-search/fixed/api/search'],
  ['/targets/history-order-router/vulnerable/api/order', '/targets/history-order-router/fixed/api/order'],
  ['/targets/same-origin-child-tab/vulnerable/api/context', '/targets/same-origin-child-tab/fixed/api/context'],
  ['/targets/jwt-lab/authorization/vulnerable/api/session', '/targets/jwt-lab/authorization/fixed/api/session'],
  ['/targets/jwt-lab/cookie/vulnerable/api/session', '/targets/jwt-lab/cookie/fixed/api/session'],
  ['/targets/jwt-lab/form/vulnerable/api/session', '/targets/jwt-lab/form/fixed/api/session'],
  ['/targets/jwt-lab/json/vulnerable/api/session', '/targets/jwt-lab/json/fixed/api/session']
])
const controlRoutes = new Set(controlFor.values())

const contracts = routes
  .filter((route) => route.kinds.includes('route-aware-runtime'))
  .map((route) => {
    const pathname = route.path
    const activeSearch = pathname.includes('/api/search')
    const activeOrder = pathname.includes('/api/order')
    const childContext = pathname.includes('/api/context')
    const jwtSession = pathname.includes('/targets/jwt-lab/') && pathname.endsWith('/api/session')
    const jwtSeed = pathname.includes('/targets/jwt-lab/cookie/') && pathname.endsWith('/api/seed')
    const workshopPost = /^\/api\/labs\/(?:session|reset|graphql\/|idor-write\/|stored-xss\/messages|jwt\/nested\/(?:vulnerable|fixed)\/admin)/.test(pathname)
    const formRoute = ['/support/tickets/create', '/switch-tenant', '/passive/upload/index.html'].includes(pathname)
    const websocket = /realtime\/ws|socket\.io|sockjs/.test(pathname)
    const securityTarget = isSecurityTarget(pathname)
    return {
      id: `dast.route.${slug(pathname)}`,
      route: pathname,
      role: controlRoutes.has(pathname) ? 'control' : securityTarget ? 'assertion' : 'infrastructure',
      disposition: securityTarget ? 'security-target' : 'runtime-support',
      category: category(pathname),
      evidence: evidence(pathname),
      transport: websocket ? 'websocket' : 'http',
      methods: websocket ? ['GET-UPGRADE'] : pathname === '/api/labs/stored-xss/messages' ? ['GET', 'POST'] : workshopPost || activeSearch || activeOrder || jwtSession ? ['POST'] : childContext || jwtSeed ? ['GET'] : formRoute ? ['GET', 'POST'] : ['GET', 'HEAD'],
      runtime: {
        kind: 'route-aware-server',
        protocol: activeSearch || pathname === '/passive/cases/headers/powered-by.html' || pathname === '/passive/cases/headers/secure-control.html' ? 'https' : activeOrder || childContext || jwtSession || jwtSeed ? 'http' : 'http-or-https',
        loopbackOnly: true
      },
      ...(controlFor.has(pathname) ? { controlRoute: controlFor.get(pathname) } : {}),
      owners: route.owners
    }
  })
  .sort((left, right) => left.route.localeCompare(right.route))

const contractRoutes = new Set(contracts.map((contract) => contract.route))
for (const required of ['/support/tickets/create', '/switch-tenant', '/passive/fixtures/headers/secure-control.html']) {
  if (!contractRoutes.has(required)) throw new Error(`route-aware contract route is missing: ${required}`)
}

const document = {
  schema: 'owasp-ptk-playground-dast-contracts/v1',
  version: 1,
  summary: {
    runtimeRoutes: contracts.length,
    securityTargets: contracts.filter((contract) => contract.disposition === 'security-target').length,
    controls: contracts.filter((contract) => contract.role === 'control').length,
    infrastructureRoutes: contracts.filter((contract) => contract.disposition === 'runtime-support').length
  },
  contracts
}

const output = `${JSON.stringify(document, null, 2)}\n`
const target = path.join(repoRoot, 'catalog/dast-contracts.json')
if (checkOnly) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) throw new Error('catalog/dast-contracts.json is stale; run npm run catalog:generate')
} else {
  fs.writeFileSync(target, output)
}

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', ...document.summary }))
