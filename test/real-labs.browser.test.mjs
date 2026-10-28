import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createSign, generateKeyPairSync } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const selected = server.address().port
      server.close((error) => error ? reject(error) : resolve(selected))
    })
  })
}

async function startRuntime() {
  const httpPort = await availablePort()
  let httpsPort = await availablePort()
  while (httpsPort === httpPort) httpsPort = await availablePort()
  const child = spawn(process.execPath, ['passive/server.mjs'], {
    cwd: root,
    env: { ...process.env, PTK_PLAYGROUND_HOST: host, PTK_PASSIVE_HTTP_PORT: String(httpPort), PTK_PASSIVE_HTTPS_PORT: String(httpsPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise((resolve, reject) => {
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`runtime startup failed: ${errors}`)), 10000)
    child.stderr.on('data', (chunk) => { errors += String(chunk) })
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes(`:${httpPort}/passive/`)) return
      clearTimeout(timer)
      resolve()
    })
    child.once('error', reject)
  })
  return { child, origin: `http://${host}:${httpPort}` }
}

async function runPaired(page, origin, slug) {
  const response = await page.goto(`${origin}/labs/${slug}/`)
  assert.equal(response.status(), 200, slug)
  await page.locator('#run-lab').click()
  await page.waitForFunction(() => document.querySelector('#lab-result').textContent.startsWith('{'))
  return JSON.parse(await page.locator('#lab-result').textContent())
}

function signedJwkToken(header, privateKey) {
  const input = [header, { sub: 'attendee', role: 'admin', aud: 'ptk-playground' }]
    .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  const signature = createSign('RSA-SHA256').update(input).end().sign(privateKey).toString('base64url')
  return `${input}.${signature}`
}

for (const browserType of [chromium, firefox]) test(`${browserType.name()} real lab tracks show exact vulnerable/repaired browser contrasts and bounded controls`, async () => {
  const { child, origin } = await startRuntime()
  let browser
  try {
    browser = await browserType.launch({ headless: true })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [homeLink, categoryPath, childLinks] of [
      ['./labs/jwt/', '/labs/jwt/', ['../jwt-none/', '../jwt-alg-confusion/', '../jwt-null-signature/', '../jwt-jwk-injection/', '../jwt-nested-weak-secret/']],
      ['./labs/sql/', '/labs/sql/', ['../sql-single-quote/', '../sql-double-quote/', '../sql-auth-bypass/']],
      ['./labs/xss/', '/labs/xss/', ['../xss-reflected/', '../xss-attribute/', '../stored-xss/', '../xss-dom/', '../xss-query-code/']],
      ['./labs/browser-context/', '/labs/browser-context/', ['../on-demand-analytics/', '../../campaigns/transient-route-notice/']],
      ['./labs/access-control/', '/labs/access-control/', ['../idor-read/', '../idor-write/', '../graphql-order/']]
    ]) {
      await page.goto(`${origin}/`)
      assert.equal(await page.locator(`section[aria-labelledby="lab-tracks-title"] a[href="${homeLink}"]`).count(), 1, `home category link: ${homeLink}`)
      const category = await page.goto(`${origin}${categoryPath}`)
      assert.equal(category.status(), 200, `category: ${categoryPath}`)
      for (const href of childLinks) assert.equal(await page.locator(`a[href="${href}"]`).count(), 1, `category lab link: ${href}`)
    }
    for (const slug of ['jwt-none', 'jwt-alg-confusion', 'jwt-null-signature', 'jwt-jwk-injection', 'sql-single-quote', 'sql-double-quote', 'sql-auth-bypass', 'xss-reflected', 'xss-dom', 'xss-attribute', 'xss-query-code']) {
      const campaign = await page.goto(`${origin}/campaigns/${slug}/`)
      assert.equal(campaign.status(), 200, `campaign: ${slug}`)
      await page.waitForFunction(() => document.querySelectorAll('[data-objective-state]').length === 3)
    }
    for (const legacy of ['/jwt/', '/labs/', '/labs/spa/']) {
      assert.equal((await page.goto(`${origin}${legacy}`)).status(), 200, `legacy route: ${legacy}`)
    }

    const none = await runPaired(page, origin, 'jwt-none')
    assert.deepEqual([none.normalReview.status, none.normalFixed.status, none.unsignedReview.status, none.unsignedFixed.status], [200, 200, 200, 401])

    const confusion = await runPaired(page, origin, 'jwt-alg-confusion')
    assert.deepEqual([confusion.normalReview.status, confusion.normalFixed.status, confusion.forgedReview.status, confusion.forgedFixed.status], [403, 403, 200, 401])

    const nullSignature = await runPaired(page, origin, 'jwt-null-signature')
    assert.deepEqual([nullSignature.normalReview.status, nullSignature.normalFixed.status,
      nullSignature.forgedReview.status, nullSignature.forgedFixed.status], [403, 403, 200, 401])
    assert.equal(JSON.parse(Buffer.from(nullSignature.forgedToken.split('.')[0], 'base64url')).alg, 'HS256')
    assert.ok(nullSignature.forgedToken.endsWith('.'))

    const jwkInjection = await runPaired(page, origin, 'jwt-jwk-injection')
    assert.deepEqual([jwkInjection.normalReview.status, jwkInjection.normalFixed.status,
      jwkInjection.forgedReview.status, jwkInjection.forgedFixed.status], [403, 403, 200, 401])
    assert.equal(JSON.parse(Buffer.from(jwkInjection.forgedToken.split('.')[0], 'base64url')).jwk.kty, 'RSA')

    const single = await runPaired(page, origin, 'sql-single-quote')
    assert.deepEqual([single.normalReview.rows.length, single.normalFixed.rows.length, single.mutatedReview.rows.length, single.mutatedFixed.rows.length], [2, 2, 4, 0])

    const double = await runPaired(page, origin, 'sql-double-quote')
    assert.deepEqual([double.normalReview.rows[0].name, double.normalFixed.rows[0].name, double.mutatedReview.rows[0].name, double.mutatedFixed.status], ['Apple', 'Apple', 'Date', 400])

    const bypass = await runPaired(page, origin, 'sql-auth-bypass')
    assert.deepEqual([bypass.normalReview.status, bypass.normalFixed.status, bypass.mutatedReview.status, bypass.mutatedFixed.status], [401, 401, 200, 401])
    assert.equal(bypass.mutatedReview.identity.role, 'admin')
    assert.equal(bypass.mutatedFixed.code, 'SYNTHETIC_LOGIN_REJECTED')

    for (const slug of ['jwt-none', 'jwt-alg-confusion', 'jwt-null-signature', 'jwt-jwk-injection', 'sql-single-quote', 'sql-double-quote', 'sql-auth-bypass']) {
      for (const variant of ['vulnerable', 'fixed']) {
        const response = await page.goto(`${origin}/labs/${slug}/?variant=${variant}`)
        assert.equal(response.status(), 200)
        await page.locator('#run-lab').click()
        await page.waitForFunction(() => document.querySelector('#lab-result').textContent.startsWith('{'))
        const result = JSON.parse(await page.locator('#lab-result').textContent())
        assert.ok(result.normal, `${slug}/${variant}: normal`)
        assert.ok(result[slug.startsWith('jwt-') ? slug === 'jwt-none' ? 'unsigned' : 'forged' : 'mutated'], `${slug}/${variant}: mutation`)
      }
    }

    for (const kind of ['reflected', 'dom']) {
      for (const variant of ['vulnerable', 'fixed']) {
        const response = await page.goto(`${origin}/targets/xss/${kind}/${variant}/`)
        assert.equal(response.status(), 200)
        await page.getByRole('link', { name: 'Run harmless proof' }).click()
        if (variant === 'vulnerable') {
          await page.waitForFunction(() => document.documentElement.dataset.ptkXss === 'executed')
          assert.equal(await page.locator('#proof-status').textContent(), 'executed')
        } else {
          await page.waitForLoadState('networkidle')
          assert.equal(await page.evaluate(() => document.documentElement.dataset.ptkXss), undefined)
          assert.equal(await page.locator('#proof-status').textContent(), 'not executed')
          assert.match(await page.locator(kind === 'dom' ? '#preview' : '#reflected-output').textContent(), /<img /)
        }
        await page.goto(`${origin}/targets/xss/${kind}/${variant}/`)
        assert.equal(await page.locator('#proof-status').textContent(), 'not executed')
      }
    }

    for (const kind of ['reflected-attribute', 'query-code']) {
      for (const variant of ['vulnerable', 'fixed']) {
        const response = await page.goto(`${origin}/targets/xss/${kind}/${variant}/`)
        assert.equal(response.status(), 200)
        await page.getByRole('link', { name: 'Run harmless proof' }).click()
        if (variant === 'vulnerable') {
          await page.waitForFunction(() => document.documentElement.dataset.ptkXss === 'executed')
          assert.equal(await page.locator('#proof-status').textContent(), 'executed')
        } else {
          await page.waitForLoadState('networkidle')
          assert.equal(await page.evaluate(() => document.documentElement.dataset.ptkXss), undefined)
          assert.equal(await page.locator('#proof-status').textContent(), 'not executed')
          const literal = kind === 'query-code'
            ? await page.locator('#preview').textContent()
            : await page.locator('#attribute-output').getAttribute('data-label')
          assert.match(literal, kind === 'query-code' ? /marker\(\)/ : /<img /)
        }
        await page.goto(`${origin}/targets/xss/${kind}/${variant}/`)
        assert.equal(await page.locator('#proof-status').textContent(), 'not executed')
      }
    }
    const attributeRoute = `${origin}/targets/xss/reflected-attribute/`
    assert.equal((await page.request.post(`${attributeRoute}vulnerable/`)).status(), 405)
    assert.equal((await page.request.get(`${attributeRoute}vulnerable/?label=${'x'.repeat(241)}`)).status(), 400)
    const attributeFixed = await page.request.get(`${attributeRoute}fixed/`)
    assert.doesNotMatch(attributeFixed.headers()['content-security-policy'], /unsafe-inline/)
    const codeFixed = await page.request.get(`${origin}/targets/xss/query-code/fixed/`)
    assert.doesNotMatch(codeFixed.headers()['content-security-policy'], /unsafe-eval/)

    const api = page.request
    const blocked = await api.post(`${origin}/api/labs/sql/auth-bypass/vulnerable`, {
      data: { username: "admin'; DROP TABLE users; --", password: 'x' }
    })
    assert.equal(blocked.status(), 400)
    assert.equal((await blocked.json()).code, 'INPUT_INVALID')
    const badMethod = await api.get(`${origin}/api/labs/sql/single-quote/vulnerable`)
    assert.equal(badMethod.status(), 405)
    for (const kind of ['null-signature', 'jwk-injection']) {
      for (const variant of ['vulnerable', 'fixed']) {
        const endpoint = `${origin}/api/labs/jwt/${kind}/${variant}`
        const malformed = await api.post(endpoint, { data: { token: 'not.a.jwt' } })
        assert.equal(malformed.status(), 401)
        const oversized = await api.post(endpoint, { data: { token: 'x'.repeat(4097) } })
        assert.equal(oversized.status(), 413)
        const wrongShape = await api.post(endpoint, { data: { token: 'x', extra: true } })
        assert.equal(wrongShape.status(), 400)
      }
    }
    const embeddedHeader = JSON.parse(Buffer.from(jwkInjection.forgedToken.split('.')[0], 'base64url'))
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicJwk = publicKey.export({ format: 'jwk' })
    const ptkHeader = { alg: 'RS256', typ: 'JWT', kid: 'ptk_jwk_injection',
      jwk: { ...publicJwk, kid: 'ptk_jwk_injection' } }
    const jwkEndpoint = `${origin}/api/labs/jwt/jwk-injection/`
    const jwkStatus = async (header, variant = 'vulnerable') => (await api.post(`${jwkEndpoint}${variant}`,
      { data: { token: signedJwkToken(header, privateKey) } })).status()
    assert.equal(await jwkStatus(ptkHeader), 200, 'PTK-shaped matching public kid is accepted')
    assert.equal(await jwkStatus(ptkHeader, 'fixed'), 401, 'repaired verifier ignores embedded key')
    for (const invalidHeader of [
      { ...ptkHeader, jwk: { ...ptkHeader.jwk, kid: 'different' } },
      { ...ptkHeader, jwk: { ...ptkHeader.jwk, kid: 'x'.repeat(65) } },
      { ...ptkHeader, jwk: { ...ptkHeader.jwk, d: 'private-material' } },
      { ...ptkHeader, jwk: { ...ptkHeader.jwk, extra: 'field' } }
    ]) assert.equal(await jwkStatus(invalidHeader), 401, 'unsupported JWK shape is rejected')
    const privateShape = { ...embeddedHeader, jwk: { ...embeddedHeader.jwk, d: 'private-material' } }
    const parts = jwkInjection.forgedToken.split('.')
    const badJwk = `${Buffer.from(JSON.stringify(privateShape)).toString('base64url')}.${parts[1]}.${parts[2]}`
    assert.equal((await api.post(`${origin}/api/labs/jwt/jwk-injection/vulnerable`, { data: { token: badJwk } })).status(), 401)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    child.kill('SIGTERM')
  }
})
