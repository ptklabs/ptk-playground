import { createHmac, createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)
const sqlWasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
let sqlModulePromise
const sqlModule = () => (sqlModulePromise ||= initSqlJs({ locateFile: () => sqlWasmPath }))

// These keys and records belong only to the synthetic, process-local lab.
const { publicKey: labPublicKey, privateKey: labPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})
const labAudience = 'ptk-playground'
const validUserClaims = { sub: 'attendee', role: 'user', aud: labAudience }
const nullSignatureKey = randomBytes(32)

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  res.end(body)
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('JSON_REQUIRED'), { status: 415 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2048) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('JSON_INVALID'), { status: 400 }) }
}

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }

function signUserToken() {
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(validUserClaims)}`
  const signature = createSign('RSA-SHA256').update(input).end().sign(labPrivateKey).toString('base64url')
  return `${input}.${signature}`
}

function parseToken(token, { allowEmptySignature = false } = {}) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.slice(0, 2).every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    || !(allowEmptySignature ? /^[A-Za-z0-9_-]*$/ : /^[A-Za-z0-9_-]+$/).test(parts[2])) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!header || typeof header !== 'object' || Array.isArray(header)
      || !claims || typeof claims !== 'object' || Array.isArray(claims)
      || header.typ !== 'JWT' || claims.aud !== labAudience
      || typeof claims.sub !== 'string' || !['user', 'admin'].includes(claims.role)) return null
    return { header, claims, input: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') }
  } catch { return null }
}

function signHmacUserToken() {
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(validUserClaims)}`
  return `${input}.${createHmac('sha256', nullSignatureKey).update(input).digest('base64url')}`
}

function verifyNullSignatureToken(token, vulnerable) {
  const parsed = parseToken(token, { allowEmptySignature: true })
  if (!parsed || parsed.header.alg !== 'HS256') return null
  if (vulnerable && parsed.signature.length === 0) return parsed.claims
  const expected = createHmac('sha256', nullSignatureKey).update(parsed.input).digest()
  return parsed.signature.length === expected.length && timingSafeEqual(parsed.signature, expected)
    ? parsed.claims : null
}

function verifyEmbeddedJwkToken(token, vulnerable) {
  const parsed = parseToken(token)
  if (!parsed || parsed.header.alg !== 'RS256') return null
  let key = labPublicKey
  if (vulnerable && parsed.header.jwk !== undefined) {
    const jwk = parsed.header.jwk
    const fields = jwk && typeof jwk === 'object' && !Array.isArray(jwk)
      ? Object.keys(jwk).sort().join(',') : ''
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)
      || (fields !== 'e,kty,n' && fields !== 'e,kid,kty,n')
      || (fields === 'e,kid,kty,n' && (typeof jwk.kid !== 'string'
        || !/^[A-Za-z0-9_-]{1,64}$/.test(jwk.kid) || parsed.header.kid !== jwk.kid))
      || jwk.kty !== 'RSA' || jwk.e !== 'AQAB'
      || typeof jwk.n !== 'string' || !/^[A-Za-z0-9_-]{342}$/.test(jwk.n)) return null
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' })
      if (key.asymmetricKeyDetails?.modulusLength !== 2048) return null
    } catch { return null }
  }
  try {
    const verifier = createVerify('RSA-SHA256').update(parsed.input)
    verifier.end()
    return verifier.verify(key, parsed.signature) ? parsed.claims : null
  } catch { return null }
}

function verifyConfusionToken(token, vulnerable) {
  const parsed = parseToken(token)
  if (!parsed) return null
  if (parsed.header.alg === 'RS256') {
    const verifier = createVerify('RSA-SHA256').update(parsed.input)
    verifier.end()
    return verifier.verify(labPublicKey, parsed.signature) ? parsed.claims : null
  }
  if (vulnerable && parsed.header.alg === 'HS256') {
    // The intentional defect: treating the published RSA key as an HMAC secret.
    const expected = createHmac('sha256', Buffer.from(labPublicKey)).update(parsed.input).digest()
    return parsed.signature.length === expected.length && timingSafeEqual(parsed.signature, expected)
      ? parsed.claims : null
  }
  return null
}

const products = [
  ['a-apple', 'Apple', 'fruit'], ['b-banana', 'Banana', 'fruit'],
  ['c-carrot', 'Carrot', 'vegetable'], ['d-date', 'Date', 'snack']
]

function validField(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 96
    && !/[;\x00-\x1f]/.test(value) && !/--|\/\*|\*\//.test(value)
}

function rowsFor(db, query, parameters = []) {
  const statement = db.prepare(query)
  try {
    statement.bind(parameters)
    const rows = []
    while (statement.step() && rows.length < 8) rows.push(statement.getAsObject())
    return rows
  } finally { statement.free() }
}

async function runSqlCase(kind, vulnerable, input) {
  const SQL = await sqlModule()
  const db = new SQL.Database()
  try {
    db.run('CREATE TABLE products (sku TEXT, name TEXT, category TEXT)')
    db.run('CREATE TABLE users (username TEXT, password TEXT, role TEXT)')
    for (const row of products) db.run('INSERT INTO products VALUES (?, ?, ?)', row)
    db.run('INSERT INTO users VALUES (?, ?, ?)', ['admin', 'synthetic-admin-password', 'admin'])
    db.run('INSERT INTO users VALUES (?, ?, ?)', ['alice', 'synthetic-alice-password', 'user'])
    db.run('PRAGMA query_only = ON')
    if (kind === 'single-quote') {
      const query = vulnerable
        ? `SELECT sku, name FROM products WHERE category = '${input.category}' ORDER BY sku LIMIT 4`
        : 'SELECT sku, name FROM products WHERE category = ? ORDER BY sku LIMIT 4'
      return { ok: true, code: 'PRODUCT_SEARCH', rows: rowsFor(db, query, vulnerable ? [] : [input.category]) }
    }
    if (kind === 'double-quote') {
      if (!vulnerable && !['sku', 'name'].includes(input.sort)) {
        return { ok: false, code: 'SORT_NOT_ALLOWED', status: 400 }
      }
      const column = vulnerable ? input.sort : { sku: 'sku', name: 'name' }[input.sort]
      return { ok: true, code: 'PRODUCT_SORT', rows: rowsFor(db,
        `SELECT sku, name FROM products ORDER BY "${column}" ASC LIMIT 4`) }
    }
    const query = vulnerable
      ? `SELECT username, role FROM users WHERE username = '${input.username}' AND password = '${input.password}' LIMIT 1`
      : 'SELECT username, role FROM users WHERE username = ? AND password = ? LIMIT 1'
    const record = rowsFor(db, query, vulnerable ? [] : [input.username, input.password])[0] || null
    return { ok: Boolean(record), code: record ? 'SYNTHETIC_LOGIN_GRANTED' : 'SYNTHETIC_LOGIN_REJECTED', identity: record, status: record ? 200 : 401 }
  } finally { db.close() }
}

export async function handleRealLabsApi(req, res, pathname) {
  const jwtPair = pathname.match(/^\/api\/labs\/jwt\/(null-signature|jwk-injection)\/(vulnerable|fixed)$/)
  if (jwtPair) {
    const [kind, variant] = jwtPair.slice(1)
    if (req.method === 'GET') {
      json(res, 200, { ok: true, code: 'SYNTHETIC_TOKEN_ISSUED', token: kind === 'null-signature' ? signHmacUserToken() : signUserToken() })
      return true
    }
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, POST' })
      return true
    }
    try {
      const body = await readJson(req)
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).join(',') !== 'token') {
        json(res, 400, { ok: false, code: 'INPUT_INVALID' })
        return true
      }
      const claims = kind === 'null-signature'
        ? verifyNullSignatureToken(body.token, variant === 'vulnerable')
        : verifyEmbeddedJwkToken(body.token, variant === 'vulnerable')
      if (!claims) json(res, 401, { ok: false, code: 'JWT_REJECTED' })
      else if (claims.role !== 'admin') json(res, 403, { ok: false, code: 'ADMIN_REQUIRED' })
      else json(res, 200, { ok: true, code: 'ADMIN_GRANTED', subject: claims.sub })
    } catch (error) { json(res, error?.status || 400, { ok: false, code: error?.message || 'REQUEST_INVALID' }) }
    return true
  }

  const jwt = pathname.match(/^\/api\/labs\/jwt\/confusion\/(vulnerable|fixed)$/)
  if (jwt) {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, code: 'SYNTHETIC_KEY_ISSUED', publicKey: labPublicKey, token: signUserToken() })
      return true
    }
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, POST' })
      return true
    }
    try {
      const body = await readJson(req)
      const claims = verifyConfusionToken(body?.token, jwt[1] === 'vulnerable')
      if (!claims) json(res, 401, { ok: false, code: 'JWT_REJECTED' })
      else if (claims.role !== 'admin') json(res, 403, { ok: false, code: 'ADMIN_REQUIRED' })
      else json(res, 200, { ok: true, code: 'ADMIN_GRANTED', subject: claims.sub })
    } catch (error) { json(res, error?.status || 400, { ok: false, code: error?.message || 'REQUEST_INVALID' }) }
    return true
  }

  const sql = pathname.match(/^\/api\/labs\/sql\/(single-quote|double-quote|auth-bypass)\/(vulnerable|fixed)$/)
  if (!sql) return false
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' })
    return true
  }
  try {
    const body = await readJson(req)
    const kind = sql[1]
    const fields = kind === 'single-quote' ? ['category'] : kind === 'double-quote' ? ['sort'] : ['username', 'password']
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== [...fields].sort().join(',')
      || fields.some((field) => !validField(body[field]))) {
      json(res, 400, { ok: false, code: 'INPUT_INVALID' })
      return true
    }
    const result = await runSqlCase(kind, sql[2] === 'vulnerable', body)
    const { status = 200, ...output } = result
    json(res, status, output)
  } catch (error) {
    // The lab has a real SQL query, but never exposes stack traces or DB internals.
    json(res, error?.status || 400, { ok: false, code: error?.status ? error.message : 'SQL_QUERY_REJECTED' })
  }
  return true
}

const reflectedProof = `<img src="/targets/xss/reflected/missing.png" onerror="document.documentElement.dataset.ptkXss='executed';document.getElementById('proof-status').textContent='executed'">`
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

export function serveReflectedXss(req, res, url) {
  const match = url.pathname.match(/^\/targets\/xss\/reflected\/(vulnerable|fixed)\/$/)
  if (!match) return false
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' })
    return true
  }
  const value = url.searchParams.get('message') || ''
  if (value.length > 240 || /[\x00-\x1f]/.test(value)) {
    json(res, 400, { ok: false, code: 'INPUT_INVALID' })
    return true
  }
  const vulnerable = match[1] === 'vulnerable'
  const output = vulnerable ? value : escapeHtml(value)
  const proofUrl = `${url.pathname}?message=${encodeURIComponent(reflectedProof)}`
  const otherUrl = `${url.pathname.replace(`/${match[1]}/`, vulnerable ? '/fixed/' : '/vulnerable/')}?message=${encodeURIComponent(value || reflectedProof)}`
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reflected XSS ${match[1]} · PTK Playground</title><link rel="stylesheet" href="/assets/css/playground.css"></head><body><main class="page-shell"><p class="eyebrow">Reflected XSS · ${match[1]}</p><h1>Search response preview</h1><p>The same message is reflected by the server. Only the review route interprets it as markup.</p><p><a class="button" href="${proofUrl}">Run harmless proof</a> <a class="button button--secondary" href="${otherUrl}">Compare ${vulnerable ? 'repaired' : 'review'} route</a></p><p>Execution marker: <strong id="proof-status">not executed</strong></p><div id="reflected-output">${output}</div><p>Reset: reload this route without the query. PTK evidence: candidate until a native finding is qualified.</p><p><a href="/labs/xss-reflected/">Lab instructions</a></p></main></body></html>`
  const payload = Buffer.from(body)
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Content-Security-Policy': `default-src 'none'; script-src 'self'${vulnerable ? " 'unsafe-inline'" : ''}; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  })
  res.end(payload)
  return true
}

const attributeProof = `"><img src="/targets/xss/reflected-attribute/missing.png" onerror="document.documentElement.dataset.ptkXss='executed';document.getElementById('proof-status').textContent='executed'">`

export function serveAttributeXss(req, res, url) {
  const match = url.pathname.match(/^\/targets\/xss\/reflected-attribute\/(vulnerable|fixed)\/$/)
  if (!match) return false
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' })
    return true
  }
  const value = url.searchParams.get('label') || ''
  if (value.length > 240 || /[\x00-\x1f]/.test(value)) {
    json(res, 400, { ok: false, code: 'INPUT_INVALID' })
    return true
  }
  const vulnerable = match[1] === 'vulnerable'
  const output = vulnerable ? value : escapeHtml(value)
  const proofUrl = `${url.pathname}?label=${encodeURIComponent(attributeProof)}`
  const otherUrl = `${url.pathname.replace(`/${match[1]}/`, vulnerable ? '/fixed/' : '/vulnerable/')}?label=${encodeURIComponent(value || attributeProof)}`
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attribute XSS ${match[1]} · PTK Playground</title><link rel="stylesheet" href="/assets/css/playground.css"></head><body><main class="page-shell"><p class="eyebrow">Attribute XSS · ${match[1]}</p><h1>Result label</h1><p>The label is placed inside a quoted HTML attribute. The repaired route encodes it for that context.</p><p><a class="button" href="${proofUrl}">Run harmless proof</a> <a class="button button--secondary" href="${otherUrl}">Compare ${vulnerable ? 'repaired' : 'review'} route</a></p><p>Execution marker: <strong id="proof-status">not executed</strong></p><div id="attribute-output" data-label="${output}">Result preview</div><p>Reset: reload this route without the query. PTK automatic finding: pending native qualification.</p><p><a href="/labs/xss-attribute/">Lab instructions</a></p></main></body></html>`
  const payload = Buffer.from(body)
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Content-Security-Policy': `default-src 'none'; script-src 'self'${vulnerable ? " 'unsafe-inline'" : ''}; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  })
  res.end(payload)
  return true
}
