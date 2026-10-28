import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'

function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const selected = server.address().port
      server.close((error) => error ? reject(error) : resolve(selected))
    })
  })
}

async function startRuntime() {
  const httpPort = await port()
  let httpsPort = await port()
  while (httpsPort === httpPort) httpsPort = await port()
  const child = spawn(process.execPath, ['passive/server.mjs'], {
    cwd: root,
    env: { ...process.env, PTK_PLAYGROUND_HOST: host, PTK_PASSIVE_HTTP_PORT: String(httpPort), PTK_PASSIVE_HTTPS_PORT: String(httpsPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise((resolve, reject) => {
    let errors = ''
    const timeout = setTimeout(() => reject(new Error(`runtime startup: ${errors}`)), 10000)
    child.stderr.on('data', (chunk) => { errors += String(chunk) })
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes(`:${httpPort}/passive/`)) return
      clearTimeout(timeout)
      resolve()
    })
    child.once('error', reject)
  })
  return { child, origin: `http://${host}:${httpPort}` }
}

async function result(page) { return JSON.parse(await page.locator('#result').textContent()) }
async function act(page, button, code) {
  await page.locator(button).click()
  await page.waitForFunction((expected) => {
    try { return JSON.parse(document.querySelector('#result').textContent).code === expected }
    catch { return false }
  }, code)
  return result(page)
}
async function signAdmin(token) {
  const [header, claims] = token.split('.')
  const payload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')), role: 'admin' })).toString('base64url')
  const content = `${header}.${payload}`
  return `${content}.${createHmac('sha256', 'secret').update(content).digest('base64url')}`
}

test('workshop labs prove separate IDOR, two-session stored XSS and nested JWT cases with controls', async () => {
  const { child, origin } = await startRuntime()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const alice = await browser.newContext()
    const bob = await browser.newContext()
    const a = await alice.newPage()
    const b = await bob.newPage()
    const pageErrors = []
    for (const page of [a, b]) page.on('pageerror', (error) => pageErrors.push(error.message))

    await a.goto(`${origin}/labs/`)
    for (const path of ['spa', 'access-control', 'xss', 'support-widget',
      'imported-request-preferences', 'on-demand-analytics', 'session-bound-order-search',
      'idor-read', 'idor-write', 'stored-xss', 'jwt-nested-weak-secret', 'graphql-order']) {
      await a.goto(`${origin}/labs/${path}/`)
      assert.equal((await a.locator('h1').count()) > 0, true)
      if (!['spa', 'access-control', 'xss'].includes(path)) {
        const body = await a.locator('body').innerText()
        for (const word of ['action', 'Vulnerable outcome', 'Repaired outcome', 'Reset', 'PTK evidence']) {
          assert.ok(body.includes(word), `${path}: missing ${word}`)
        }
      }
    }
    await a.goto(`${origin}/campaigns/transient-route-notice/`)
    assert.equal(await a.locator('[data-mission-objectives]').count(), 1)
    for (const mission of ['idor-read', 'idor-write', 'stored-xss', 'jwt-nested-weak-secret']) {
      await a.goto(`${origin}/campaigns/${mission}/`, { waitUntil: 'networkidle' })
      assert.equal(await a.locator('[data-objective-state]').count(), 3, mission)
    }

    await a.goto(`${origin}/labs/graphql-order/`)
    assert.match(await a.locator('h1').textContent(), /GraphQL/)
    await a.goto(`${origin}/campaigns/graphql-order/`, { waitUntil: 'networkidle' })
    assert.equal(await a.locator('[data-objective-state]').count(), 3)

    await a.goto(`${origin}/targets/graphql/order/vulnerable/`)
    await a.locator('#login').click()
    await a.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).identity === 'alice' } catch { return false } })
    await a.locator('#request').click()
    await a.waitForFunction(() => { try { return Boolean(JSON.parse(document.querySelector('#result').textContent).data?.order) } catch { return false } })
    assert.equal((await result(a)).data.order.owner, 'bob')
    await a.goto(`${origin}/targets/graphql/order/fixed/`)
    await a.locator('#request').click()
    await a.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).errors?.[0]?.extensions?.code === 'FORBIDDEN' } catch { return false } })
    assert.equal((await result(a)).data.order, null)
    await a.locator('#object').selectOption('order-alice')
    await a.locator('#request').click()
    await a.waitForFunction(() => { try { return JSON.parse(document.querySelector('#result').textContent).data?.order?.id === 'order-alice' } catch { return false } })
    assert.equal((await result(a)).data.order.owner, 'alice')
    const graphqlNegatives = await a.evaluate(async () => {
      const query = 'query Order($id: ID!) { order(id: $id) { id owner note } }'
      const send = (body) => fetch('/api/labs/graphql/vulnerable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const unsupported = await send({ query: '{ __schema { types { name } } }', variables: {} })
      const unknownField = await send({ query: query.replace('note', 'secret'), variables: { id: 'order-bob' } })
      const unknownObject = await send({ query, variables: { id: 'order-c' } })
      return [unsupported.status, unknownField.status, unknownObject.status]
    })
    assert.deepEqual(graphqlNegatives, [400, 400, 400])
    const stranger = await browser.newContext()
    try {
      const response = await stranger.request.post(`${origin}/api/labs/graphql/vulnerable`, {
        data: { query: 'query Order($id: ID!) { order(id: $id) { id owner note } }', variables: { id: 'order-bob' } }
      })
      assert.equal(response.status(), 401)
    } finally { await stranger.close() }

    await a.goto(`${origin}/targets/access-control/idor-read/vulnerable/`)
    assert.equal((await act(a, '#login', undefined)).identity, 'alice')
    await a.locator('#object').selectOption('order-bob')
    assert.equal((await act(a, '#request', 'OBJECT_READ')).object.owner, 'bob')
    await a.goto(`${origin}/targets/access-control/idor-read/fixed/`)
    await a.locator('#object').selectOption('order-bob')
    assert.equal((await act(a, '#request', 'OBJECT_FORBIDDEN')).status, 403)

    await a.goto(`${origin}/targets/access-control/idor-write/vulnerable/`)
    await a.locator('#object').selectOption('order-bob')
    await a.locator('#note').fill('Alice changed this')
    assert.equal((await act(a, '#request', 'OBJECT_UPDATED')).status, 200)
    await b.goto(`${origin}/targets/access-control/idor-read/vulnerable/`)
    await b.locator('#actor').selectOption('bob')
    await act(b, '#login', undefined)
    await b.locator('#object').selectOption('order-bob')
    assert.equal((await act(b, '#request', 'OBJECT_READ')).object.note, 'Alice changed this')
    await a.goto(`${origin}/targets/access-control/idor-write/fixed/`)
    await a.locator('#object').selectOption('order-bob')
    await a.locator('#note').fill('Blocked update')
    assert.equal((await act(a, '#request', 'OBJECT_FORBIDDEN')).status, 403)

    const reset = await a.evaluate(async () => {
      const response = await fetch('/api/labs/reset', { method: 'POST' })
      return { status: response.status, ...await response.json() }
    })
    assert.deepEqual(reset, { status: 200, ok: true, code: 'LAB_RESET' })
    await b.goto(`${origin}/targets/access-control/idor-read/vulnerable/`)
    await b.locator('#object').selectOption('order-bob')
    assert.equal((await act(b, '#request', 'OBJECT_READ')).object.note, 'Bob draft')

    await a.goto(`${origin}/targets/stored-xss/vulnerable/`)
    const proof = '<img src=x onerror="document.documentElement.dataset.storedXss=\'executed\'">'
    await a.locator('#message').fill(proof)
    assert.equal((await act(a, '#save', 'MESSAGE_SAVED')).status, 200)
    await b.goto(`${origin}/targets/stored-xss/vulnerable/`)
    await act(b, '#load', 'MESSAGE_LOADED')
    await b.waitForFunction(() => document.documentElement.dataset.storedXss === 'executed')
    await b.goto(`${origin}/targets/stored-xss/fixed/`)
    await act(b, '#load', 'MESSAGE_LOADED')
    assert.equal(await b.locator('#preview').textContent(), proof)
    assert.equal(await b.evaluate(() => document.documentElement.dataset.storedXss), undefined)

    await a.goto(`${origin}/targets/jwt-lab/nested-json-weak-secret/`)
    await act(a, '#issue', 'JWT_ISSUED')
    const userToken = await a.locator('#token').inputValue()
    assert.equal((await act(a, '#send', 'ADMIN_REQUIRED')).status, 403)
    const forged = await signAdmin(userToken)
    await a.locator('#token').fill(forged)
    assert.equal((await act(a, '#send', 'ADMIN_GRANTED')).status, 200)
    await a.locator('#variant').selectOption('fixed')
    assert.equal((await act(a, '#send', 'JWT_REJECTED')).status, 401)
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
  }
})
