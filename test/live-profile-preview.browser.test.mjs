import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41738
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

test('live profile preview requests one JSON document only after action and repairs only its DOM write', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const pageErrors = []
    const externalRequests = []
    const profileRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.origin !== baseUrl) externalRequests.push(request.url())
      if (url.pathname === '/targets/live-profile-preview/profile.json') profileRequests.push(url.pathname)
    })

    await page.goto(`${baseUrl}/campaigns/live-profile-preview/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-objective-state="available"]').count(), 1)
    await page.locator('[data-mission-mode="scanner"]').click()
    assert.equal(await page.locator('[data-scanner-targets] .scanner-target-card').count(), 2)
    assert.equal(await page.locator('[data-scanner-targets] code:has-text("#load-profile")').count(), 2)

    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${baseUrl}/targets/live-profile-preview/vulnerable/`, { waitUntil: 'networkidle' })
    assert.deepEqual(profileRequests, [])
    await page.locator('#load-profile').click()
    await page.waitForFunction(() => document.getElementById('profile-status')?.textContent === 'PROFILE-RESPONSE-MARKUP-RENDERED')
    assert.deepEqual(profileRequests, ['/targets/live-profile-preview/profile.json'])
    assert.equal(await page.locator('#profile-preview mark[data-profile-proof]').count(), 1)
    assert.equal(await page.locator('#profile-preview').textContent(), 'Priority customer profile')

    profileRequests.length = 0
    await page.goto(`${baseUrl}/targets/live-profile-preview/fixed/`, { waitUntil: 'networkidle' })
    assert.deepEqual(profileRequests, [])
    await page.locator('#load-profile').click()
    await page.waitForFunction(() => document.getElementById('profile-status')?.textContent === 'PROFILE-RESPONSE-TEXT-SAFE')
    assert.deepEqual(profileRequests, ['/targets/live-profile-preview/profile.json'])
    assert.equal(await page.locator('#profile-preview mark').count(), 0)
    assert.match(await page.locator('#profile-preview').textContent(), /^<mark data-profile-proof="true">/)

    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))), [])
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    await context.close()
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
