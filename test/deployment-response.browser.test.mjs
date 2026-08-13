import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const campaignUrl = 'http://localhost:3080/campaigns/deployment-response-boundary/'
const reviewUrl = 'https://localhost:3443/passive/cases/headers/powered-by.html'
const repairedUrl = 'https://localhost:3443/passive/cases/headers/secure-control.html'

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

test('deployment response mission proves one response-only disclosure and a clean paired control', async () => {
  const server = startServer()
  await waitForServer(server)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(campaignUrl, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('[data-route-server-panel]:visible').count(), 0)
    assert.equal(await page.locator('[data-objective-state="available"]').count(), 1)
    await page.locator('[data-mission-mode="scanner"]').click()
    const targetLinks = await page.locator('[data-scanner-targets] a').evaluateAll((links) =>
      links.map((link) => link.href).filter((href) => href.includes('/passive/cases/headers/'))
    )
    assert.deepEqual(targetLinks.sort(), [reviewUrl, repairedUrl].sort())

    const reviewResponse = await page.goto(reviewUrl, { waitUntil: 'networkidle' })
    assert.equal((await reviewResponse.allHeaders())['x-powered-by'], 'PTK Header Canary')
    const reviewBody = await page.locator('main').textContent()
    await page.locator('#inspect-response').click()
    await page.waitForFunction(() => document.getElementById('response-inspection')?.textContent === 'RESPONSE-METADATA-DISCLOSED')

    const repairedResponse = await page.goto(repairedUrl, { waitUntil: 'networkidle' })
    assert.equal((await repairedResponse.allHeaders())['x-powered-by'], undefined)
    const repairedBody = await page.locator('main').textContent()
    await page.locator('#inspect-response').click()
    await page.waitForFunction(() => document.getElementById('response-inspection')?.textContent === 'RESPONSE-METADATA-CLEAN')

    assert.equal(reviewBody, repairedBody)
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('owasp-browser-security-campaign'))), [])
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    server.kill('SIGTERM')
  }
})
