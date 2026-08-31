import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const payload = encode({ sub: 'ptk-playground', scope: 'demo' })
const jwt = (header, signature = 'invalid') => `${encode(header)}.${payload}.${signature}`

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function startRuntime(httpPort, httpsPort) {
  return spawn(process.execPath, ['passive/server.mjs'], {
    cwd: playgroundRoot,
    env: {
      ...process.env,
      PTK_PLAYGROUND_HOST: host,
      PTK_PASSIVE_HTTP_PORT: String(httpPort),
      PTK_PASSIVE_HTTPS_PORT: String(httpsPort)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function waitForRuntime(child, httpPort) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`JWT lab runtime did not become ready: ${stderr}`)), 10000)
    const onStdout = (chunk) => {
      if (!String(chunk).includes(`:${httpPort}/passive/`)) return
      clearTimeout(timer)
      child.stdout.off('data', onStdout)
      resolve()
    }
    child.stdout.on('data', onStdout)
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
  })
}

async function post(request, origin, carrier, variant, token) {
  const url = `${origin}/targets/jwt-lab/${carrier}/${variant}/api/session`
  const headers = { 'X-Playground-Request': 'jwt-lab' }
  const options = { headers }
  if (carrier === 'authorization') headers.Authorization = `Bearer ${token}`
  if (carrier === 'cookie') headers.Cookie = `ptk_jwt_lab_session=${token}`
  if (carrier === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    options.data = new URLSearchParams({ access_token: token, keep: 'unchanged' }).toString()
  }
  if (carrier === 'json') {
    headers['Content-Type'] = 'application/json'
    options.data = JSON.stringify({ auth: { access_token: token }, keep: 'unchanged' })
  }
  const response = await request.post(url, options)
  return { status: response.status(), body: await response.json() }
}

test('JWT lab proves storage discovery and paired request-carrier behavior', async () => {
  const httpPort = await allocatePort()
  let httpsPort = await allocatePort()
  while (httpsPort === httpPort) httpsPort = await allocatePort()
  const origin = `http://${host}:${httpPort}`
  const runtime = startRuntime(httpPort, httpsPort)
  let browser = null
  try {
    await waitForRuntime(runtime, httpPort)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(`${origin}/jwt/`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('heading', { name: 'Follow one synthetic token across the browser and HTTP request surface.' }).count(), 1)

    await page.goto(`${origin}/jwt/storage/vulnerable/`, { waitUntil: 'networkidle' })
    const reviewStorage = await page.evaluate(() => ({
      local: localStorage.getItem('ptk_playground_access_token'),
      session: sessionStorage.getItem('ptk_playground_id_token'),
      cookie: document.cookie
    }))
    assert.match(reviewStorage.local, /^ey[A-Za-z0-9_-]+\./)
    assert.match(reviewStorage.session, /^ey[A-Za-z0-9_-]+\./)
    assert.match(reviewStorage.cookie, /ptk_playground_jwt=ey/)

    await page.goto(`${origin}/jwt/storage/fixed/`, { waitUntil: 'networkidle' })
    const fixedStorage = await page.evaluate(() => ({
      local: localStorage.getItem('ptk_playground_access_token'),
      session: sessionStorage.getItem('ptk_playground_id_token'),
      cookie: document.cookie
    }))
    assert.equal(fixedStorage.local, 'opaque-session-reference')
    assert.equal(fixedStorage.session, 'opaque-session-reference')
    assert.match(fixedStorage.cookie, /ptk_playground_jwt=opaque-session-reference/)
    assert.doesNotMatch(JSON.stringify(fixedStorage), /ey[A-Za-z0-9_-]+\./)

    const algNone = jwt({ alg: 'none', typ: 'JWT' }, '')
    assert.deepEqual(await post(context.request, origin, 'authorization', 'vulnerable', algNone), {
      status: 200,
      body: { ok: true, code: 'JWT_ACCEPTED', message: 'Synthetic JWT accepted for the demo account.', carrier: 'authorization' }
    })
    assert.equal((await post(context.request, origin, 'authorization', 'fixed', algNone)).status, 401)

    const emptySignature = jwt({ alg: 'HS256', typ: 'JWT' }, '')
    assert.equal((await post(context.request, origin, 'form', 'vulnerable', emptySignature)).status, 200)
    assert.equal((await post(context.request, origin, 'form', 'fixed', emptySignature)).status, 401)

    const kidPath = jwt({ alg: 'HS256', typ: 'JWT', kid: '../../../../../dev/null' })
    const kidReview = await post(context.request, origin, 'json', 'vulnerable', kidPath)
    assert.equal(kidReview.status, 400)
    assert.equal(kidReview.body.code, 'JWT_KID_PATH')
    assert.equal((await post(context.request, origin, 'json', 'fixed', kidPath)).body.code, 'JWT_REJECTED')

    const remoteJku = jwt({ alg: 'RS256', typ: 'JWT', jku: 'https://keys.example.test/jwks.json' })
    const jkuReview = await post(context.request, origin, 'cookie', 'vulnerable', remoteJku)
    assert.equal(jkuReview.status, 400)
    assert.equal(jkuReview.body.code, 'JWT_REMOTE_KEY')
    assert.equal((await post(context.request, origin, 'cookie', 'fixed', remoteJku)).body.code, 'JWT_REJECTED')

    await page.goto(`${origin}/targets/jwt-lab/dast/`, { waitUntil: 'networkidle' })
    for (const carrier of ['authorization', 'cookie', 'form', 'json']) {
      await page.locator(`[data-jwt-carrier="${carrier}"][data-jwt-variant="vulnerable"]`).click()
      await page.waitForFunction((value) => document.querySelector(`[data-jwt-result="${value}"]`)?.textContent.includes('HTTP 200'), carrier)
    }
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    if (browser) await browser.close()
    runtime.kill('SIGTERM')
  }
})
