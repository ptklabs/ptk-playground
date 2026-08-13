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
const staticPort = 41743
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
    response.writeHead(200, { 'content-type': contentType(absolutePath), 'cache-control': 'no-store' })
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

async function stopRouteServer(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await exited
}

test('curated demo keeps static mode bounded and enables the full local presenter journey', async () => {
  const staticServer = createStaticServer()
  await listen(staticServer)
  const browser = await chromium.launch({ headless: true })
  let routeServer
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const externalRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    page.on('request', (request) => {
      const origin = new URL(request.url()).origin
      if (![staticOrigin, 'http://localhost:3080', 'https://localhost:3443'].includes(origin)) externalRequests.push(request.url())
    })

    let response = await page.goto(`${staticOrigin}/demo/`, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('[data-demo-chapter]').count(), 3)
    assert.equal(await page.locator('[data-demo-target]').count(), 4)
    assert.equal(await page.locator('[data-demo-target-disabled]').count(), 2)
    assert.equal(await page.locator('[data-demo-mission-link]').count(), 3)
    assert.equal(await page.locator('[data-demo-status]').textContent(), 'Static demo mode')
    assert.equal(await page.locator('[data-demo-target] a[href^="http://localhost"], [data-demo-target][href^="http://localhost"]').count(), 0)

    const checkpoints = [
      ['widget-trust-boundary', 'combined'],
      ['session-request', 'real-context'],
      ['transient-spa-state', 'transient-route']
    ]
    for (const [chapterId, answer] of checkpoints) {
      const form = page.locator(`[data-demo-checkpoint="${chapterId}"]`)
      await form.locator('select').selectOption(answer)
      await form.locator('button[type="submit"]').click()
      await page.locator(`[data-demo-chapter="${chapterId}"][data-chapter-state="complete"]`).waitFor()
    }
    assert.equal(await page.locator('[data-demo-progress-count]').textContent(), '3')
    assert.equal(await page.locator('[data-demo-conclusion]:visible').count(), 1)

    await page.locator('[data-reset-demo]').click()
    assert.equal(await page.locator('[data-demo-progress-count]').textContent(), '0')
    assert.equal(await page.locator('[data-demo-checkpoint]').count(), 3)
    assert.equal(await page.locator('[data-demo-conclusion]:visible').count(), 0)

    const supportMissionHref = await page.locator('[data-demo-mission-link="support-widget"]').getAttribute('href')
    assert.match(supportMissionHref, /\/campaigns\/support-widget\/\?mode=demo$/)
    response = await page.goto(supportMissionHref, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('button[data-mission-mode="demo"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.demo-cue').count(), 3)

    await close(staticServer)
    routeServer = startRouteServer()
    await waitForRouteServer(routeServer)

    response = await page.goto('http://localhost:3080/demo/', { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('[data-demo-status]').textContent(), 'Full demo runtime detected')
    assert.equal(await page.locator('[data-demo-target]').count(), 6)
    assert.equal(await page.locator('[data-demo-target-disabled]').count(), 0)
    assert.equal(await page.locator('[data-demo-target][href^="http://localhost:3080/"]').count(), 4)
    assert.equal(await page.locator('[data-demo-target][href^="https://localhost:3443/"]').count(), 2)

    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }))
    assert.ok(dimensions.scrollWidth <= dimensions.width + 1)
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    if (staticServer.listening) await close(staticServer)
    await stopRouteServer(routeServer)
  }
})
