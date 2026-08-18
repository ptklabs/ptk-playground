import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staticHost = '127.0.0.1'
const staticPort = 41750
const staticOrigin = `http://${staticHost}:${staticPort}`
const runtimeOrigin = 'http://127.0.0.1:3080'

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, staticOrigin)
    let relativePath = decodeURIComponent(url.pathname)
    if (relativePath.endsWith('/')) relativePath += 'index.html'
    const absolutePath = path.resolve(playgroundRoot, `.${relativePath}`)
    if (!absolutePath.startsWith(`${playgroundRoot}${path.sep}`) || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentType(absolutePath), 'cache-control': 'no-store' })
    fs.createReadStream(absolutePath).pipe(response)
  })
}

async function listen(server, port = staticPort) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, staticHost, resolve)
  })
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

function startRuntime() {
  return spawn(process.execPath, ['passive/server.mjs'], {
    cwd: playgroundRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function waitForRuntime(child) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`route-aware server did not become ready: ${stderr}`)), 10000)
    const onStdout = (chunk) => {
      if (!String(chunk).includes('HTTP ready on http://localhost:3080/passive/')) return
      clearTimeout(timer)
      child.stdout.off('data', onStdout)
      resolve()
    }
    child.stdout.on('data', onStdout)
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`route-aware server exited before readiness (${code}): ${stderr}`))
    })
  })
}

test('SPA deep dive proves History API, lazy-route and child-tab behavior on a static project host', async () => {
  const server = createStaticServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const externalRequests = []
    const loadedPaths = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== staticOrigin) externalRequests.push(request.url())
      loadedPaths.push(url.pathname)
    })

    await page.goto(`${staticOrigin}/targets/history-order-router/vulnerable/`, { waitUntil: 'networkidle' })
    await page.locator('#open-order-route').click()
    await page.waitForFunction(() => document.getElementById('order-route-status')?.textContent === 'HISTORY-ORDER-ROUTE-MARKUP')
    assert.equal(await page.locator('#order-route-view mark[data-history-order-proof]').count(), 1)
    assert.equal(new URL(page.url()).searchParams.get('order'), 'order-4815')
    await page.locator('#previous-route').click()
    await page.waitForFunction(() => document.getElementById('order-route-status')?.textContent === 'HISTORY-ORDER-IDLE')

    await page.goto(`${staticOrigin}/targets/history-order-router/fixed/`, { waitUntil: 'networkidle' })
    await page.locator('#open-order-route').click()
    await page.waitForFunction(() => document.getElementById('order-route-status')?.textContent === 'HISTORY-ORDER-ROUTE-TEXT-SAFE')
    assert.equal(await page.locator('#order-route-view mark').count(), 0)
    assert.equal(await page.locator('#order-route-view').textContent(), 'Order 4815')

    loadedPaths.length = 0
    await page.goto(`${staticOrigin}/targets/lazy-route-module/vulnerable/`, { waitUntil: 'networkidle' })
    assert.ok(!loadedPaths.some((pathname) => pathname.endsWith('/analytics-route.js')))
    assert.ok(!loadedPaths.some((pathname) => pathname.includes('/assets/vendor/jquery/')))
    await page.locator('#open-analytics-route').click()
    await page.waitForFunction(() => document.getElementById('analytics-route-status')?.textContent === 'LAZY-ROUTE-MODULE-AND-DEPENDENCY-LOADED')
    assert.equal(await page.locator('#analytics-route-workspace strong[data-lazy-route-proof]').count(), 1)
    assert.ok(loadedPaths.some((pathname) => pathname.endsWith('/analytics-route.js')))
    assert.ok(loadedPaths.some((pathname) => pathname.endsWith('/jquery-3.4.1.min.js')))

    loadedPaths.length = 0
    await page.goto(`${staticOrigin}/targets/lazy-route-module/fixed/`, { waitUntil: 'networkidle' })
    assert.ok(!loadedPaths.some((pathname) => pathname.endsWith('/analytics-route.js')))
    await page.locator('#open-analytics-route').click()
    await page.waitForFunction(() => document.getElementById('analytics-route-status')?.textContent === 'LAZY-ROUTE-MODULE-TEXT-SAFE')
    assert.equal(await page.locator('#analytics-route-workspace strong').count(), 0)
    assert.equal(await page.locator('#analytics-route-workspace').textContent(), 'Quarterly analytics ready')
    assert.ok(loadedPaths.some((pathname) => pathname.endsWith('/jquery-3.7.1.min.js')))

    await page.goto(`${staticOrigin}/targets/same-origin-child-tab/vulnerable/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#open-external-control:visible').count(), 0)
    const reviewChildPromise = context.waitForEvent('page')
    await page.locator('#open-related-child').click()
    const reviewChild = await reviewChildPromise
    await reviewChild.waitForLoadState('networkidle')
    await reviewChild.waitForFunction(() => document.getElementById('child-runtime-status')?.textContent === 'RELATED-CHILD-MESSAGE-MARKUP')
    assert.equal(new URL(reviewChild.url()).origin, staticOrigin)
    assert.equal(await reviewChild.locator('#child-message-output strong[data-child-tab-proof]').count(), 1)
    assert.match(await reviewChild.locator('#child-dependency-status').textContent(), /3\.4\.1/)
    await reviewChild.close()

    await page.goto(`${staticOrigin}/targets/same-origin-child-tab/fixed/`, { waitUntil: 'networkidle' })
    const fixedChildPromise = context.waitForEvent('page')
    await page.locator('#open-related-child').click()
    const fixedChild = await fixedChildPromise
    await fixedChild.waitForLoadState('networkidle')
    await fixedChild.waitForFunction(() => document.getElementById('child-runtime-status')?.textContent === 'RELATED-CHILD-MESSAGE-TEXT-SAFE')
    assert.equal(await fixedChild.locator('#child-message-output strong').count(), 0)
    assert.match(await fixedChild.locator('#child-message-output').textContent(), /<strong data-child-tab-proof="true">/)
    assert.match(await fixedChild.locator('#child-dependency-status').textContent(), /3\.7\.1/)
    await fixedChild.close()

    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    await close(server)
  }
})

test('SPA deep dive local runtime enforces session APIs and exposes an explicit different-origin control', async () => {
  const runtime = startRuntime()
  await waitForRuntime(runtime)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const apiRequests = []
    const contextResponses = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/order')) apiRequests.push(request)
    })
    context.on('response', async (response) => {
      if (!new URL(response.url()).pathname.endsWith('/api/context')) return
      contextResponses.push({ url: response.url(), headers: await response.allHeaders() })
    })

    await page.goto(`${runtimeOrigin}/targets/history-order-router/vulnerable/`, { waitUntil: 'networkidle' })
    const sessionCookie = (await context.cookies(page.url())).find((cookie) => cookie.name === 'ptk_history_order_session')
    assert.ok(sessionCookie)
    assert.equal(sessionCookie.httpOnly, true)
    assert.equal(sessionCookie.sameSite, 'Strict')
    assert.equal(sessionCookie.path, '/targets/history-order-router/')
    await page.locator('#open-order-route').click()
    await page.waitForFunction(() => document.getElementById('order-api-status')?.textContent.includes('authenticated API'))
    const reviewMutation = await page.evaluate(async () => {
      const response = await fetch('./api/order', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Playground-Request': 'history-order-router' },
        body: JSON.stringify({ orderId: "order-4815'" })
      })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(reviewMutation.status, 500)
    assert.equal(reviewMutation.body.code, 'ORDER_LOOKUP_SYNTAX')

    await page.goto(`${runtimeOrigin}/targets/history-order-router/fixed/`, { waitUntil: 'networkidle' })
    await page.locator('#open-order-route').click()
    await page.waitForFunction(() => document.getElementById('order-api-status')?.textContent.includes('authenticated API'))
    const fixedMutation = await page.evaluate(async () => {
      const response = await fetch('./api/order', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Playground-Request': 'history-order-router' },
        body: JSON.stringify({ orderId: "order-4815'" })
      })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(fixedMutation.status, 400)
    assert.equal(fixedMutation.body.code, 'ORDER_ID_FORMAT_REJECTED')
    assert.ok(apiRequests.length >= 4)
    assert.ok(apiRequests.every((request) => request.method() === 'POST'))

    await page.goto(`${runtimeOrigin}/targets/same-origin-child-tab/vulnerable/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#open-external-control:visible').count(), 1)
    const childPromise = context.waitForEvent('page')
    await page.locator('#open-related-child').click()
    const child = await childPromise
    await child.waitForFunction(() => document.getElementById('child-runtime-status')?.textContent === 'RELATED-CHILD-MESSAGE-MARKUP')
    assert.equal(new URL(child.url()).origin, runtimeOrigin)
    await child.close()

    const externalPromise = context.waitForEvent('page')
    await page.locator('#open-external-control').click()
    const externalControl = await externalPromise
    await externalControl.waitForLoadState('domcontentloaded')
    assert.equal(new URL(externalControl.url()).origin, 'http://localhost:3080')
    assert.equal(await externalControl.locator('[data-playground-target="same-origin-child-tab-external-control"]').count(), 1)
    await externalControl.close()

    await page.goto(`${runtimeOrigin}/targets/same-origin-child-tab/fixed/`, { waitUntil: 'networkidle' })
    const fixedChildPromise = context.waitForEvent('page')
    await page.locator('#open-related-child').click()
    const fixedChild = await fixedChildPromise
    await fixedChild.waitForFunction(() => document.getElementById('child-runtime-status')?.textContent === 'RELATED-CHILD-MESSAGE-TEXT-SAFE')
    await fixedChild.close()

    assert.equal(contextResponses.length, 2)
    assert.equal(contextResponses[0].headers['x-powered-by'], 'PTK Child Context Canary')
    assert.equal(contextResponses[1].headers['x-powered-by'], undefined)
    await context.close()
  } finally {
    await browser.close()
    runtime.kill('SIGTERM')
  }
})
