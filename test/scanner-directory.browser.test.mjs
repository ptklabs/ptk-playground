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
const staticPort = 41736
const staticOrigin = `http://${staticHost}:${staticPort}`

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, staticOrigin)
    let relativePath = decodeURIComponent(url.pathname)
    if (relativePath.endsWith('/')) relativePath += 'index.html'
    const absolutePath = path.resolve(playgroundRoot, `.${relativePath}`)
    if (!absolutePath.startsWith(playgroundRoot) || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentType(absolutePath) })
    fs.createReadStream(absolutePath).pipe(response)
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(staticPort, staticHost, resolve)
  })
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

function startRouteServer() {
  return spawn(process.execPath, ['passive/server.mjs'], {
    cwd: playgroundRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function waitForRouteServer(child) {
  return new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`route-aware server did not become ready: ${stderr}`)), 10000)
    const onStdout = (chunk) => {
      if (!String(chunk).includes('HTTPS ready on https://localhost:3443/passive/')) return
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

test('scanner directory keeps static hosting safe and enables every paired target in route-aware mode', async () => {
  const staticServer = createStaticServer()
  await listen(staticServer)
  const browser = await chromium.launch({ headless: true })
  let routeServer
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors = []
    const externalRequests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('request', (request) => {
      const origin = new URL(request.url()).origin
      if (![staticOrigin, 'http://localhost:3080', 'https://localhost:3443'].includes(origin)) externalRequests.push(request.url())
    })

    let response = await page.goto(`${staticOrigin}/scanner/`, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('[data-scanner-mission]').count(), 8)
    assert.equal(await page.locator('[data-scanner-target]').count(), 16)
    assert.equal(await page.locator('[data-scanner-target] a[href="#scanner-server"]').count(), 4)
    assert.equal(await page.locator('[data-scanner-target] a[href^="http://localhost"], [data-scanner-target] a[href^="https://localhost"]').count(), 0)
    assert.equal(await page.locator('[data-scanner-status]').textContent(), 'Static catalogue mode')

    await page.locator('[data-scanner-filter="engine"]').selectOption('DAST')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 3)
    assert.equal(await page.locator('[data-scanner-target]').count(), 6)
    await page.locator('[data-scanner-filter="engine"]').selectOption('SCA')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 2)
    await page.locator('[data-scanner-filter="engine"]').selectOption('')
    await page.locator('[data-scanner-filter="runtime"]').selectOption('static')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 6)
    await page.locator('[data-scanner-filter="runtime"]').selectOption('route-aware-server')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 2)
    await page.locator('[data-scanner-filter="runtime"]').selectOption('')
    await page.locator('[data-scanner-filter="search"]').fill('session-bound')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 1)
    assert.equal(await page.locator('[data-scanner-summary]').textContent(), '1 mission · 2 paired targets')

    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }))
    assert.ok(dimensions.scrollWidth <= dimensions.width + 1)

    await close(staticServer)
    routeServer = startRouteServer()
    await waitForRouteServer(routeServer)

    response = await page.goto('http://localhost:3080/scanner/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('[data-scanner-status]').textContent(), 'Route-aware server detected')
    assert.equal(await page.locator('[data-scanner-mission]').count(), 8)
    assert.equal(await page.locator('[data-scanner-target]').count(), 16)
    assert.equal(await page.locator('[data-scanner-target] a[href^="https://localhost:3443/"]').count(), 4)
    assert.equal(await page.locator('[data-scanner-target] a[href^="http://localhost:3080/"]').count(), 12)

    response = await page.goto('http://localhost:3080/targets/support-widget/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    await page.locator('#send-support-message').click()
    await page.waitForFunction(() => document.getElementById('support-status')?.textContent === 'WIDGET-MESSAGE-RENDERED')

    response = await page.goto('http://localhost:3080/targets/on-demand-analytics/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    await page.locator('#load-analytics').click()
    await page.waitForFunction(() => document.getElementById('analytics-status')?.textContent === 'ANALYTICS-DEPENDENCY-LOADED')

    response = await page.goto('http://localhost:3080/targets/live-profile-preview/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    await page.locator('#load-profile').click()
    await page.waitForFunction(() => document.getElementById('profile-status')?.textContent === 'PROFILE-RESPONSE-MARKUP-RENDERED')

    response = await page.goto('http://localhost:3080/targets/transient-route-notice/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    await page.locator('#open-route-notice').click()
    await page.waitForFunction(() => document.getElementById('route-status')?.textContent === 'ROUTE-NOTICE-TRANSIENT-MARKUP')

    response = await page.goto('http://localhost:3080/targets/imported-request-preferences/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    await page.locator('#import-preferences').click()
    await page.waitForFunction(() => document.getElementById('preferences-status')?.textContent === 'PREFERENCE-INHERITED-REQUEST-OPTION')

    response = await page.goto('https://localhost:3443/targets/session-bound-order-search/vulnerable/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    if (staticServer.listening) await close(staticServer)
    routeServer?.kill('SIGTERM')
  }
})
