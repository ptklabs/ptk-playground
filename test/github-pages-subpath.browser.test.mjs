import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41745
const prefix = '/ptk-playground/'
const origin = `http://${host}:${port}`
const baseUrl = `${origin}${prefix}`

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  return 'application/octet-stream'
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, origin)
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    let relativePath = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html'
    const absolutePath = path.resolve(playgroundRoot, relativePath)
    if (!absolutePath.startsWith(`${playgroundRoot}${path.sep}`) || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
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

test('GitHub Pages project subpath loads catalogues, campaigns and direct static targets', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    const failedLocalResponses = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400) {
        failedLocalResponses.push(`${response.status()} ${response.url()}`)
      }
    })

    for (const pathname of [
      '',
      'campaigns/',
      'demo/',
      'scanner/',
      'campaigns/support-widget/',
      'targets/support-widget/vulnerable/',
      'targets/support-widget/fixed/',
      'sast/',
      'iast/',
      'passive/'
    ]) {
      const response = await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200, pathname || 'home')
      if (!pathname.startsWith('targets/')) {
        await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'ready')
      }
      assert.equal(await page.locator('main').count(), 1, pathname || 'home')
    }

    await page.goto(`${baseUrl}campaigns/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-mission-card]').count(), 8)
    assert.equal(await page.locator('[data-product-preview]').count(), 3)
    assert.equal(await page.locator('[data-product-preview="saved-workspace"] a').getAttribute('href'), `${baseUrl}campaigns/saved-workspace/`)
    assert.equal(await page.locator('[data-product-preview="session-bound-order-search"] a').count(), 0)
    await page.goto(`${baseUrl}scanner/`, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-scanner-target]').count(), 16)
    assert.deepEqual(failedLocalResponses, [])
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await close(server)
  }
})
