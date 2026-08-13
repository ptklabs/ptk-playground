import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41740
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

test('imported request preferences preserve one request while repairing inherited configuration', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const externalRequests = []
    const previewRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== baseUrl) externalRequests.push(request.url())
      if (request.url() === `${baseUrl}/targets/imported-request-preferences/preview.json`) {
        previewRequests.push(request.url())
      }
    })

    await page.goto(`${baseUrl}/campaigns/imported-request-preferences/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-objective-state="available"]').count(), 1)
    await page.locator('[data-mission-mode="scanner"]').click()
    assert.equal(await page.locator('[data-scanner-targets] .scanner-target-card').count(), 2)
    assert.equal(await page.locator('[data-scanner-targets] code:has-text("#import-preferences")').count(), 2)

    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${baseUrl}/targets/imported-request-preferences/vulnerable/`, { waitUntil: 'networkidle' })
    await page.locator('#import-preferences').click()
    await page.locator('#preferences-status').filter({ hasText: 'PREFERENCE-INHERITED-REQUEST-OPTION' }).waitFor()
    assert.match(await page.locator('#request-details').textContent(), /Own option keys: \(none\)/)
    assert.match(await page.locator('#request-details').textContent(), /Inherited credentials: include/)
    assert.equal(await page.evaluate(() => ({}).credentials), undefined)

    await page.goto(`${baseUrl}/targets/imported-request-preferences/fixed/`, { waitUntil: 'networkidle' })
    await page.locator('#import-preferences').click()
    await page.locator('#preferences-status').filter({ hasText: 'PREFERENCE-ALLOWLISTED-REQUEST-OPTION' }).waitFor()
    assert.match(await page.locator('#request-details').textContent(), /Own credentials: same-origin/)
    assert.match(await page.locator('#request-details').textContent(), /Prototype: none/)

    await page.locator('#preferences-json').fill('{"credentials":"include","__proto__":{"mode":"no-cors"},"headers":{"x-demo":"ignored"}}')
    await page.locator('#import-preferences').click()
    await page.locator('#preferences-status').filter({ hasText: 'PREFERENCE-ALLOWLISTED-REQUEST-OPTION' }).waitFor()
    assert.match(await page.locator('#request-details').textContent(), /Own option keys: credentials/)
    assert.doesNotMatch(await page.locator('#request-details').textContent(), /headers|mode/)
    assert.equal(previewRequests.length, 3)
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))), [])
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
