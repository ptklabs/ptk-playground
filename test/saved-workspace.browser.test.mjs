import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41737
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
    response.writeHead(200, { 'content-type': contentType(absolutePath) })
    fs.createReadStream(absolutePath).pipe(response)
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test('saved-workspace carries state into a child document and repairs only its rendering sink', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors = []
    const externalRequests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== baseUrl) externalRequests.push(request.url())
    })

    await page.goto(`${baseUrl}/campaigns/saved-workspace/`, { waitUntil: 'networkidle' })
    await page.locator('[data-mission-mode="scanner"]').click()
    assert.deepEqual(
      (await page.locator('[data-scanner-targets] .scanner-route').allTextContents()).sort(),
      [
        '/targets/saved-workspace/fixed/dashboard.html',
        '/targets/saved-workspace/fixed/',
        '/targets/saved-workspace/vulnerable/dashboard.html',
        '/targets/saved-workspace/vulnerable/'
      ].sort()
    )
    await page.evaluate(() => sessionStorage.clear())

    await page.goto(`${baseUrl}/targets/saved-workspace/vulnerable/`, { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.clear())
    await Promise.all([
      page.waitForURL('**/targets/saved-workspace/vulnerable/dashboard.html'),
      page.locator('#save-announcement').click()
    ])
    assert.equal(await page.locator('#announcement-preview strong[data-workspace-marker]').count(), 1)
    assert.equal(await page.locator('#announcement-status').textContent(), 'SAVED-WORKSPACE-MARKUP-RENDERED')
    assert.equal(
      await page.evaluate(() => localStorage.getItem('ptk_saved_workspace_announcement_review')),
      '<strong data-workspace-marker="true">Quarterly review is ready</strong>'
    )

    await page.goto(`${baseUrl}/targets/saved-workspace/fixed/`, { waitUntil: 'networkidle' })
    await Promise.all([
      page.waitForURL('**/targets/saved-workspace/fixed/dashboard.html'),
      page.locator('#save-announcement').click()
    ])
    assert.equal(await page.locator('#announcement-preview strong').count(), 0)
    assert.match(await page.locator('#announcement-preview').textContent(), /<strong data-workspace-marker="true">/)
    assert.equal(await page.locator('#announcement-status').textContent(), 'SAVED-WORKSPACE-TEXT-SAFE')

    await page.locator('#clear-announcement').click()
    await page.waitForURL('**/targets/saved-workspace/fixed/')
    assert.equal(await page.evaluate(() => localStorage.getItem('ptk_saved_workspace_announcement_control')), null)
    assert.deepEqual(
      await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))),
      []
    )
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    await close(server)
  }
})
