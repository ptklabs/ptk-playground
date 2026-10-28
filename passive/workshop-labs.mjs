import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

const weakJwtKey = Buffer.from('secret', 'utf8') // Deliberately weak, synthetic lab material.
const fixedJwtKey = randomBytes(32)
const sessions = new Map()
const orders = new Map([
  ['order-alice', { id: 'order-alice', owner: 'alice', note: 'Alice draft' }],
  ['order-bob', { id: 'order-bob', owner: 'bob', note: 'Bob draft' }]
])
const orderQuery = 'query Order($id: ID!) { order(id: $id) { id owner note } }'
let savedMessage = ''

function reply(res, status, value, headers = {}) {
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
    if (size > 4096) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('JSON_INVALID'), { status: 400 }) }
}

function sessionFor(req) {
  const raw = String(req.headers.cookie || '').split(/;\s*/)
    .find((part) => part.startsWith('ptk_lab_session='))?.slice('ptk_lab_session='.length)
  const session = raw && sessions.get(raw)
  if (!session || session.expires < Date.now()) return null
  return session
}

function signJwt(payload, key) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const content = `${header}.${claims}`
  return `${content}.${createHmac('sha256', key).update(content).digest('base64url')}`
}

function verifyJwt(token, key) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT' || claims?.aud !== 'ptk-playground') return null
    const expected = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest()
    const actual = Buffer.from(parts[2], 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    return claims
  } catch { return null }
}

function requireMethod(req, res, method) {
  if (req.method === method) return true
  reply(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: method })
  return false
}

export async function handleWorkshopLabApi(req, res, pathname) {
  if (!pathname.startsWith('/api/labs/')) return false
  try {
    if (pathname === '/api/labs/session') {
      if (!requireMethod(req, res, 'POST')) return true
      const { identity } = await readJson(req)
      if (!['alice', 'bob'].includes(identity)) {
        reply(res, 400, { ok: false, code: 'IDENTITY_INVALID' })
        return true
      }
      const token = randomUUID()
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value)
      sessions.set(token, { identity, expires: Date.now() + 60 * 60 * 1000 })
      reply(res, 200, { ok: true, identity }, {
        'Set-Cookie': `ptk_lab_session=${token}; Path=/api/labs/; HttpOnly; SameSite=Strict`
      })
      return true
    }
    if (pathname === '/api/labs/me') {
      if (!requireMethod(req, res, 'GET')) return true
      const session = sessionFor(req)
      reply(res, session ? 200 : 401, session
        ? { ok: true, identity: session.identity }
        : { ok: false, code: 'SESSION_REQUIRED' })
      return true
    }
    if (pathname === '/api/labs/reset') {
      if (!requireMethod(req, res, 'POST')) return true
      if (!sessionFor(req)) { reply(res, 401, { ok: false, code: 'SESSION_REQUIRED' }); return true }
      for (const [id, record] of orders) orders.set(id, { ...record, note: `${record.owner === 'alice' ? 'Alice' : 'Bob'} draft` })
      savedMessage = ''
      reply(res, 200, { ok: true, code: 'LAB_RESET' })
      return true
    }

    const graphQl = pathname.match(/^\/api\/labs\/graphql\/(vulnerable|fixed)$/)
    if (graphQl) {
      if (!requireMethod(req, res, 'POST')) return true
      const session = sessionFor(req)
      if (!session) { reply(res, 401, { errors: [{ message: 'Session required', extensions: { code: 'UNAUTHENTICATED' } }] }); return true }
      const body = await readJson(req)
      if (body?.query !== orderQuery || !body?.variables || typeof body.variables !== 'object'
        || Array.isArray(body.variables) || Object.keys(body).sort().join(',') !== 'query,variables'
        || Object.keys(body.variables).join(',') !== 'id'
        || !['order-alice', 'order-bob'].includes(body.variables.id)) {
        reply(res, 400, { errors: [{ message: 'Unsupported operation', extensions: { code: 'BAD_REQUEST' } }] })
        return true
      }
      const record = orders.get(body.variables.id)
      if (graphQl[1] === 'fixed' && record.owner !== session.identity) {
        reply(res, 200, { data: { order: null }, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] })
        return true
      }
      reply(res, 200, { data: { order: { ...record } } })
      return true
    }

    const object = pathname.match(/^\/api\/labs\/idor-(read|write)\/(vulnerable|fixed)\/objects\/(order-alice|order-bob)$/)
    if (object) {
      const [, kind, variant, id] = object
      if (!requireMethod(req, res, kind === 'read' ? 'GET' : 'POST')) return true
      const session = sessionFor(req)
      if (!session) { reply(res, 401, { ok: false, code: 'SESSION_REQUIRED' }); return true }
      const record = orders.get(id)
      if (variant === 'fixed' && record.owner !== session.identity) {
        reply(res, 403, { ok: false, code: 'OBJECT_FORBIDDEN' })
        return true
      }
      if (kind === 'write') {
        const body = await readJson(req)
        if (typeof body?.note !== 'string' || !body.note.trim() || body.note.length > 160) {
          reply(res, 400, { ok: false, code: 'NOTE_INVALID' })
          return true
        }
        record.note = body.note
      }
      reply(res, 200, { ok: true, code: kind === 'read' ? 'OBJECT_READ' : 'OBJECT_UPDATED', actor: session.identity, object: { ...record } })
      return true
    }

    if (pathname === '/api/labs/stored-xss/messages') {
      const session = sessionFor(req)
      if (!session) { reply(res, 401, { ok: false, code: 'SESSION_REQUIRED' }); return true }
      if (req.method === 'POST') {
        if (session.identity !== 'alice') { reply(res, 403, { ok: false, code: 'AUTHOR_REQUIRED' }); return true }
        const body = await readJson(req)
        if (typeof body?.message !== 'string' || !body.message.trim() || body.message.length > 512) {
          reply(res, 400, { ok: false, code: 'MESSAGE_INVALID' }); return true
        }
        savedMessage = body.message
        reply(res, 200, { ok: true, code: 'MESSAGE_SAVED' })
        return true
      }
      if (!requireMethod(req, res, 'GET')) return true
      reply(res, 200, { ok: true, code: 'MESSAGE_LOADED', viewer: session.identity, message: savedMessage })
      return true
    }

    const jwt = pathname.match(/^\/api\/labs\/jwt\/nested\/(vulnerable|fixed)\/(issue|admin)$/)
    if (jwt) {
      const [, variant, operation] = jwt
      const key = variant === 'vulnerable' ? weakJwtKey : fixedJwtKey
      if (operation === 'issue') {
        if (!requireMethod(req, res, 'GET')) return true
        reply(res, 200, { ok: true, code: 'JWT_ISSUED', token: signJwt({ sub: 'attendee', role: 'user', aud: 'ptk-playground' }, key) })
        return true
      }
      if (!requireMethod(req, res, 'POST')) return true
      const body = await readJson(req)
      const claims = verifyJwt(body?.auth?.access_token, key)
      if (!claims) { reply(res, 401, { ok: false, code: 'JWT_REJECTED' }); return true }
      if (claims.role !== 'admin') { reply(res, 403, { ok: false, code: 'ADMIN_REQUIRED' }); return true }
      reply(res, 200, { ok: true, code: 'ADMIN_GRANTED', subject: claims.sub })
      return true
    }
    reply(res, 404, { ok: false, code: 'LAB_ROUTE_NOT_FOUND' })
    return true
  } catch (error) {
    reply(res, error?.status || 400, { ok: false, code: error?.message || 'REQUEST_INVALID' })
    return true
  }
}
