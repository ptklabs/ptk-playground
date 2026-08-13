import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41739
const baseUrl = `http://${host}:${port}`

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, baseUrl)
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
    server.listen(port, host, resolve)
  })
}

async function observePreparedMarkup(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const target = document.getElementById('route-notice')
    const observer = new MutationObserver(() => {
      if (!target.querySelector('[data-route-proof]')) return
      observer.disconnect()
      resolve(true)
    })
    observer.observe(target, { childList: true, subtree: true })
    document.getElementById('open-route-notice').click()
    window.setTimeout(() => {
      observer.disconnect()
      resolve(false)
    }, 500)
  }))
}

test('transient route notice preserves one SPA action while repairing the short-lived DOM sink', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const externalRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== baseUrl) externalRequests.push(request.url())
    })

    await page.goto(`${baseUrl}/campaigns/transient-route-notice/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-objective-state="available"]').count(), 1)
    await page.locator('[data-mission-mode="scanner"]').click()
    assert.equal(await page.locator('[data-scanner-targets] .scanner-target-card').count(), 2)
    assert.equal(await page.locator('[data-scanner-targets] code:has-text("#open-route-notice")').count(), 2)

    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${baseUrl}/targets/transient-route-notice/vulnerable/`, { waitUntil: 'networkidle' })
    assert.equal(new URL(page.url()).hash, '')
    assert.equal(await observePreparedMarkup(page), true)
    assert.match(new URL(page.url()).hash, /^#\/incidents\?notice=/)
    assert.equal(await page.locator('#route-status').textContent(), 'ROUTE-NOTICE-TRANSIENT-MARKUP')
    await page.waitForTimeout(80)
    assert.equal(await page.locator('#route-notice [data-route-proof]').count(), 0)
    assert.equal(await page.locator('#route-notice').textContent(), 'The route notice expired.')

    await page.goto(`${baseUrl}/targets/transient-route-notice/fixed/`, { waitUntil: 'networkidle' })
    assert.equal(new URL(page.url()).hash, '')
    assert.equal(await observePreparedMarkup(page), false)
    assert.match(new URL(page.url()).hash, /^#\/incidents\?notice=/)
    assert.equal(await page.locator('#route-status').textContent(), 'ROUTE-NOTICE-TEXT-SAFE')
    assert.equal(await page.locator('#route-notice [data-route-proof]').count(), 0)
    assert.equal(await page.locator('#route-notice').textContent(), 'The route notice expired.')

    await page.goto(`${baseUrl}/targets/transient-route-notice/fixed/#/incidents?notice=${encodeURIComponent('<mark data-route-proof="true">unexpected</mark>')}`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#route-status').textContent(), 'ROUTE-NOTICE-REJECTED')
    assert.equal(await page.locator('#route-notice [data-route-proof]').count(), 0)
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))), [])
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
