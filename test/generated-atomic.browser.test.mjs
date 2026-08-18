import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41758
const baseUrl = `http://${host}:${port}`

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'application/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function server() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, baseUrl)
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (!relative || relative.endsWith('/')) relative += 'index.html'
    const absolute = path.resolve(repoRoot, relative)
    if (!absolute.startsWith(`${repoRoot}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentType(absolute) })
    fs.createReadStream(absolute).pipe(response)
  })
}

function challenges(catalogPath) {
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, catalogPath), 'utf8'))
  return catalog.challenges
}

test('every migrated historical SAST and IAST assertion has a local executable review/control pair', async () => {
  const localServer = server()
  await new Promise((resolve, reject) => {
    localServer.once('error', reject)
    localServer.listen(port, host, resolve)
  })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const externalRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== baseUrl && !['blob:', 'data:'].includes(url.protocol)) externalRequests.push(request.url())
  })
  context.on('page', async (child) => {
    await child.waitForLoadState('domcontentloaded').catch(() => {})
    await child.close().catch(() => {})
  })

  try {
    const fixtures = [
      ...challenges('catalog/sast-atomic.json').map((challenge) => ({ engine: 'SAST', challenge })),
      ...challenges('catalog/iast-atomic.json').map((challenge) => ({ engine: 'IAST', challenge }))
    ]
    assert.equal(fixtures.length, 275, 'unique generated SAST/IAST assertions drifted')
    for (const { engine, challenge } of fixtures) {
      for (const [variant, route] of [['review', challenge.reviewRoute], ['fixed', challenge.repairedRoute]]) {
        const pathname = new URL(route.replace(/^\.\//, '/'), baseUrl).pathname
        const response = await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
        assert.equal(response.status(), 200, `${engine}:${challenge.id}:${variant}`)
        assert.equal(await page.locator(`[data-variant="${variant}"]`).count(), 1, `${engine}:${challenge.id}:${variant}:variant`)
        assert.equal(await page.locator('.atomic-workbench').count(), 1, `${engine}:${challenge.id}:${variant}:workbench`)
        assert.equal(await page.locator('.atomic-pair-note').count(), 1, `${engine}:${challenge.id}:${variant}:paired-control`)
        assert.equal(await page.locator('#run-case').count(), 1, `${engine}:${challenge.id}:${variant}:trigger`)
        const before = page.url()
        await page.locator('#run-case').click({ noWaitAfter: true })
        await page.waitForTimeout(80)
        const evidence = await page.locator('#evidence').textContent().catch(() => '')
        const evidenceState = await page.locator('#evidence').getAttribute('data-state').catch(() => '')
        assert.ok(
          ['complete', 'boundary'].includes(evidenceState) || page.url() !== before,
          `${engine}:${challenge.id}:${variant}:no terminal boundary evidence (${evidence})`
        )
        assert.equal(new URL(page.url()).origin, baseUrl, `${engine}:${challenge.id}:${variant}:left local scope`)
      }
    }
    assert.deepEqual(externalRequests, [])
  } finally {
    await browser.close()
    await new Promise((resolve) => localServer.close(resolve))
  }
})
