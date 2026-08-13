import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = 41734
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

test('playground desktop and mobile smoke stays local and renders the focused canaries', async () => {
  const server = createServer()
  await listen(server)
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 }
    ]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      const errors = []
      const externalRequests = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.origin !== baseUrl) externalRequests.push(request.url())
      })

      for (const pathname of ['/', '/campaigns/', '/demo/', '/scanner/', '/campaigns/support-widget/', '/campaigns/on-demand-analytics/', '/campaigns/saved-workspace/', '/campaigns/live-profile-preview/', '/campaigns/transient-route-notice/', '/campaigns/imported-request-preferences/', '/sast/', '/iast/', '/passive/']) {
        const response = await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200, `${viewport.name}:${pathname}`)
        assert.equal(await page.locator('main').count(), 1, `${viewport.name}:${pathname} main`)
        const dimensions = await page.evaluate(() => {
          const width = document.documentElement.clientWidth
          const offenders = [...document.querySelectorAll('body *')]
            .map((element) => {
              const rect = element.getBoundingClientRect()
              const className = String(element.className || '').trim().split(/\s+/).filter(Boolean).join('.')
              return {
                selector: element.id
                  ? `${element.tagName.toLowerCase()}#${element.id}`
                  : `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`,
                left: Math.round(rect.left * 100) / 100,
                right: Math.round(rect.right * 100) / 100,
                width: Math.round(rect.width * 100) / 100
              }
            })
            .filter((element) => element.left < -1 || element.right > width + 1)
            .slice(0, 8)
          return { width, scrollWidth: document.documentElement.scrollWidth, offenders }
        })
        assert.ok(
          dimensions.scrollWidth <= dimensions.width + 1,
          `${viewport.name}:${pathname} has horizontal overflow: ${JSON.stringify(dimensions)}`
        )
      }

      assert.equal(await page.goto(`${baseUrl}/campaigns/`, { waitUntil: 'networkidle' }).then((response) => response.status()), 200)
      assert.equal(await page.locator('[data-mission-card]').count(), 8)
      assert.equal(await page.locator('[data-product-preview]').count(), 3)
      assert.equal(await page.locator('[data-product-preview][data-preview-status="validated"]').count(), 2)
      assert.equal(await page.locator('[data-product-preview][data-preview-status="in-progress"]').count(), 1)
      assert.equal(await page.locator('[data-product-preview][data-preview-status="validated"] a').count(), 2)
      assert.equal(await page.locator('[data-product-preview="session-bound-order-search"] a').count(), 0)
      assert.match(await page.locator('.product-preview').textContent(), /PTK Pro — Coming soon/)
      assert.match(await page.locator('[data-product-preview="session-bound-order-search"]').textContent(), /Roadmap only — no preview scan or detection claim/)

      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
      assert.equal(await page.locator('[data-product-preview]').count(), 3)
      assert.equal(await page.locator('[data-product-preview] .badge--preview').allTextContents().then((values) => values.every((value) => value === 'PTK Pro')), true)

      await page.goto(`${baseUrl}/campaigns/deployment-response-boundary/`, { waitUntil: 'networkidle' })
      assert.equal(await page.locator('[data-route-server-panel]:visible').count(), 1)
      assert.equal(await page.locator('[data-objective-id="discover"] a[href="#mission-server"]').count(), 1)
      await page.locator('[data-mission-mode="scanner"]').click()
      assert.equal(await page.locator('[data-scanner-targets] a[href="#mission-server"]').count(), 2)

      await page.goto(`${baseUrl}/campaigns/session-bound-order-search/`, { waitUntil: 'networkidle' })
      assert.equal(await page.locator('[data-route-server-panel]:visible').count(), 1)
      await page.locator('[data-mission-mode="scanner"]').click()
      assert.equal(await page.locator('[data-scanner-targets] a[href="#mission-server"]').count(), 2)
      assert.equal(await page.locator('[data-scanner-targets] .scanner-route').count(), 4)

      for (const fixture of [
        ['/sast/cases/dom_xss_hash_innerhtml_vulnerable.html', 'hash-html-rendering'],
        ['/sast/cases/dom_xss_hash_textcontent_safe.html', 'hash-text-rendering-control'],
        ['/iast/iast_angularjs_expression_minimal.html', 'angularjs-expression-parser']
      ]) {
        const response = await page.goto(`${baseUrl}${fixture[0]}`, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200, `${viewport.name}:${fixture[0]}`)
        assert.equal(await page.locator(`[data-ptk-case="${fixture[1]}"]`).count(), 1)
      }

      await page.locator('#parse-expression').click()
      await assert.doesNotReject(async () => {
        await page.waitForFunction(() => document.getElementById('expression-result')?.textContent === 'Result: 3')
      })

      await page.goto(`${baseUrl}/campaigns/support-widget/`, { waitUntil: 'networkidle' })
      assert.equal(await page.locator('[data-objective-state="available"]').count(), 1)
      assert.equal(await page.locator('[data-objective-state="locked"]').count(), 2)
      await page.locator('#objective-answer-discover').selectOption('message-html')
      await page.locator('[data-objective-id="discover"] button[type="submit"]').click()
      assert.equal(await page.locator('[data-objective-id="prove"][data-objective-state="available"]').count(), 1)
      await page.locator('#objective-answer-prove').fill('WIDGET-MESSAGE-RENDERED')
      await page.locator('[data-objective-id="prove"] button[type="submit"]').click()
      assert.equal(await page.locator('[data-objective-id="fix"][data-objective-state="available"]').count(), 1)
      await page.locator('#objective-answer-fix').fill('WIDGET-SAFE-RENDER')
      await page.locator('[data-objective-id="fix"] button[type="submit"]').click()
      assert.equal(await page.locator('[data-progress-count]').textContent(), '3')

      await page.locator('[data-mission-mode="scanner"]').click()
      assert.equal(await page.locator('[data-scanner-panel]:visible').count(), 1)
      assert.equal(await page.locator('[data-scanner-targets] .scanner-target-card').count(), 2)
      assert.equal(await page.locator('.mission-progress:visible').count(), 0)

      await page.evaluate(() => sessionStorage.clear())
      await page.goto(`${baseUrl}/targets/support-widget/vulnerable/`, { waitUntil: 'networkidle' })
      await page.locator('#send-support-message').click()
      await page.waitForFunction(() => document.getElementById('support-status')?.textContent === 'WIDGET-MESSAGE-RENDERED')
      assert.equal(await page.locator('#support-thread strong[data-support-proof]').count(), 1)

      await page.goto(`${baseUrl}/targets/support-widget/fixed/`, { waitUntil: 'networkidle' })
      await page.locator('#send-support-message').click()
      await page.waitForFunction(() => document.getElementById('support-status')?.textContent === 'WIDGET-SAFE-RENDER')
      assert.equal(await page.locator('#support-thread strong').count(), 0)
      assert.match(await page.locator('#support-thread').textContent(), /<strong data-support-proof="true">/)

      const targetStorageKeys = await page.evaluate(() => Object.keys(sessionStorage))
      assert.deepEqual(targetStorageKeys.filter((key) => key.includes('owasp-browser-security-campaign')), [])
      assert.deepEqual(externalRequests, [], `${viewport.name} loaded an external resource`)
      assert.deepEqual(errors, [], `${viewport.name} emitted browser errors`)
      await context.close()
    }
  } finally {
    await browser.close()
    await close(server)
  }
})
