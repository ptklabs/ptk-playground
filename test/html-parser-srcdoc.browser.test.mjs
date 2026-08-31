import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium, firefox } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog/iast-atomic.json'), 'utf8'))

function allocatePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : null
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'application/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function createServer(baseUrl) {
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

function challenge(sourcePath, label) {
  const match = catalog.challenges.find((entry) => entry.sourcePath === sourcePath && entry.title === label)
  assert.ok(match, `missing atomic IAST challenge: ${sourcePath} / ${label}`)
  return match
}

function routeUrl(baseUrl, route, value) {
  const url = new URL(route.replace(/^\.\//, '/'), baseUrl)
  if (value !== undefined) url.searchParams.set('value', value)
  return url.href
}

async function runParserCases(page, baseUrl) {
  const direct = challenge('iast/iast_dom_parser_xss.html', 'DOMParser.parseFromString')
  const html = '<strong data-ptk-evidence="runtime">HTML evidence</strong>'
  const svg = '<svg><text data-ptk-evidence="runtime">SVG evidence</text></svg>'

  for (const [mime, value] of [
    ['text/html', html],
    ['application/xhtml+xml', html],
    ['image/svg+xml', svg]
  ]) {
    await page.goto(routeUrl(baseUrl, direct.reviewRoute, value), { waitUntil: 'domcontentloaded' })
    await page.locator('#parser-mime').selectOption(mime)
    await page.locator('#run-case').click()
    await page.locator('#evidence[data-state="complete"]').waitFor()
    assert.equal(await page.locator('#output [data-ptk-evidence="runtime"]').count(), 1, `review parser did not render ${mime}`)
  }

  await page.goto(routeUrl(baseUrl, direct.reviewRoute, html), { waitUntil: 'domcontentloaded' })
  await page.locator('#parser-mime').selectOption('text/plain')
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="boundary"]').waitFor()

  await page.goto(routeUrl(baseUrl, direct.repairedRoute, html), { waitUntil: 'domcontentloaded' })
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.locator('#output [data-ptk-evidence]').count(), 0)
  assert.equal(await page.locator('#output').textContent(), html)

  const response = challenge('iast/iast_response_field_reachability.html', 'response.html → DOMParser.parseFromString')
  await page.goto(routeUrl(baseUrl, response.reviewRoute), { waitUntil: 'domcontentloaded' })
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.locator('#output [data-ptk-evidence="response"]').count(), 1)

  await page.goto(routeUrl(baseUrl, response.repairedRoute), { waitUntil: 'domcontentloaded' })
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.locator('#output [data-ptk-evidence]').count(), 0)
  assert.match(await page.locator('#output').textContent(), /PTK response evidence/)
}

async function runSrcdocCases(page, baseUrl) {
  const html = '<strong data-ptk-evidence="srcdoc">iframe evidence</strong>'
  const direct = challenge('iast/iast_iframe_navigation.html', 'iframe.srcdoc = HTML')

  await page.goto(routeUrl(baseUrl, direct.reviewRoute, html), { waitUntil: 'domcontentloaded' })
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-evidence="srcdoc"]').count(), 1)

  await page.goto(routeUrl(baseUrl, direct.repairedRoute, html), { waitUntil: 'domcontentloaded' })
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-control="constant"]').count(), 1)
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-evidence]').count(), 0)
  assert.equal(await page.locator('#output').textContent(), html)

  const secondary = challenge('iast/iast_dom_xss_secondary_sources.html', 'iframe.srcdoc = payload')
  await page.goto(routeUrl(baseUrl, secondary.reviewRoute), { waitUntil: 'domcontentloaded' })
  await page.locator('#case-input').fill(html)
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('ptkAtomicSecondaryHtml')), html)
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-evidence="srcdoc"]').count(), 1)

  await page.goto(routeUrl(baseUrl, secondary.repairedRoute), { waitUntil: 'domcontentloaded' })
  await page.locator('#case-input').fill(html)
  await page.locator('#run-case').click()
  await page.locator('#evidence[data-state="complete"]').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('ptkAtomicSecondaryHtml')), html)
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-control="constant"]').count(), 1)
  assert.equal(await page.frameLocator('#preview').locator('[data-ptk-evidence]').count(), 0)
  assert.equal(await page.locator('#output').textContent(), html)
}

test('DOMParser and iframe.srcdoc pairs preserve exact browser behavior in Chromium and Firefox', async () => {
  const port = await allocatePort()
  const baseUrl = `http://${host}:${port}`
  const localServer = createServer(baseUrl)
  await new Promise((resolve, reject) => {
    localServer.once('error', reject)
    localServer.listen(port, host, resolve)
  })

  try {
    for (const [name, browserType] of [['Chromium', chromium], ['Firefox', firefox]]) {
      const browser = await browserType.launch({ headless: true })
      const context = await browser.newContext()
      const page = await context.newPage()
      const pageErrors = []
      const externalRequests = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.origin !== baseUrl && !['blob:', 'data:'].includes(url.protocol)) externalRequests.push(request.url())
      })
      try {
        await runParserCases(page, baseUrl)
        await runSrcdocCases(page, baseUrl)
        assert.deepEqual(pageErrors, [], `${name} page errors`)
        assert.deepEqual(externalRequests, [], `${name} external requests`)
      } finally {
        await context.close()
        await browser.close()
      }
    }
  } finally {
    await new Promise((resolve) => localServer.close(resolve))
  }
})
