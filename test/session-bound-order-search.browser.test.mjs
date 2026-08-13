import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const campaignUrl = 'http://localhost:3080/campaigns/session-bound-order-search/'
const reviewUrl = 'https://localhost:3443/targets/session-bound-order-search/vulnerable/'
const repairedUrl = 'https://localhost:3443/targets/session-bound-order-search/fixed/'

function startServer() {
  return spawn(process.execPath, ['passive/server.mjs'], {
    cwd: playgroundRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function waitForServer(child) {
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

test('session-bound order-search mission proves a captured POST weakness and a clean paired control', async () => {
  const server = startServer()
  await waitForServer(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const failedRequests = []
    const APIRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`))
    page.on('request', (request) => {
      if (!new URL(request.url()).pathname.endsWith('/api/search')) return
      APIRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
        headers: request.headers()
      })
    })

    await page.goto(campaignUrl, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-route-server-panel]:visible').count(), 0)
    await page.locator('[data-mission-mode="scanner"]').click()
    const targetLinks = await page.locator('[data-scanner-targets] a').evaluateAll((links) =>
      links.map((link) => link.href).filter((href) =>
        href.startsWith('https://localhost:3443/targets/session-bound-order-search/')
      )
    )
    assert.deepEqual(targetLinks.sort(), [reviewUrl, repairedUrl].sort())
    assert.deepEqual(
      (await page.locator('[data-scanner-targets] .scanner-route').allTextContents())
        .filter((route) => route.endsWith('/api/search'))
        .sort(),
      [
        '/targets/session-bound-order-search/fixed/api/search',
        '/targets/session-bound-order-search/vulnerable/api/search'
      ]
    )
    assert.equal(await page.locator('[data-scanner-targets]').getByText('POST', { exact: true }).count(), 2)
    assert.equal(await page.locator('[data-scanner-targets]').getByText('application/x-www-form-urlencoded', { exact: true }).count(), 2)

    const reviewResponse = await page.goto(reviewUrl, { waitUntil: 'networkidle' })
    assert.equal(reviewResponse.status(), 200)
    const reviewBody = await page.locator('main').textContent()
    const sessionCookies = await context.cookies(reviewUrl)
    const sessionCookie = sessionCookies.find((cookie) => cookie.name === 'ptk_order_session')
    assert.ok(sessionCookie)
    assert.equal(sessionCookie.value, 'active')
    assert.equal(sessionCookie.httpOnly, true)
    assert.equal(sessionCookie.secure, true)
    assert.equal(sessionCookie.sameSite, 'Strict')
    assert.equal(sessionCookie.path, '/targets/session-bound-order-search/')

    await page.locator('#order-search-form button[type="submit"]').click()
    await page.waitForFunction(() => document.getElementById('order-search-result')?.textContent === 'One matching order')
    await page.locator('#prepared-diagnostic').click()
    await page.waitForFunction(() => document.getElementById('order-search-result')?.textContent === 'ORDER-SEARCH-DATABASE-ERROR')

    const repairedResponse = await page.goto(repairedUrl, { waitUntil: 'networkidle' })
    assert.equal(repairedResponse.status(), 200)
    const repairedBody = await page.locator('main').textContent()
    await page.locator('#order-search-form button[type="submit"]').click()
    await page.waitForFunction(() => document.getElementById('order-search-result')?.textContent === 'One matching order')
    await page.locator('#prepared-diagnostic').click()
    await page.waitForFunction(() => document.getElementById('order-search-result')?.textContent === 'ORDER-SEARCH-SAFE')

    assert.equal(reviewBody, repairedBody)
    assert.equal(APIRequests.length, 4)
    for (const request of APIRequests) {
      assert.equal(request.method, 'POST')
      assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded;charset=UTF-8')
      assert.equal(request.headers['x-playground-request'], 'order-search')
      assert.match(request.body, /^query=/)
      assert.equal(new URL(request.url).origin, 'https://localhost:3443')
    }
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))), [])
    assert.deepEqual(failedRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
})
