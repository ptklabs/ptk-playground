const cases = {
  'jwt-none': {
    title: 'JWT 1 · Algorithm none',
    intro: 'A synthetic bearer token with an unsigned alg:none header is accepted by the review verifier and rejected by the repaired verifier.',
    action: 'Start PTK DAST, then press Run paired requests once. It sends a normal synthetic request and the same unsigned mutation to both verifiers.',
    expected: 'Normal token: HTTP 200 on both. Unsigned token: HTTP 200 on vulnerable, HTTP 401 on fixed.',
    reset: 'Stateless: press Run again or reload. No account or server record is changed.',
    evidence: 'Compare the captured Authorization requests and their responses in PTK DAST/Proxy. A native JWT None finding is not assumed from the browser response alone.',
    run: runJwtNone
  },
  'jwt-alg-confusion': {
    title: 'JWT 2 · Algorithm confusion',
    intro: 'The review verifier mistakes its published RSA public key for an HMAC secret. The repaired verifier pins RS256.',
    action: 'Start PTK, then press Run paired requests once. The browser receives a synthetic RS256 user token and public key, creates an HS256 admin token with those public bytes, and sends both tokens to both verifiers.',
    expected: 'Valid user token: HTTP 403 on both admin routes. Forged admin token: HTTP 200 on vulnerable, HTTP 401 on fixed.',
    reset: 'Stateless: press Run again or reload. The keypair is generated for this local server process only.',
    evidence: 'Compare the algorithms, signature decisions and admin response in PTK Proxy/Request Builder. No automatic PTK rule is claimed.',
    run: runJwtConfusion
  },
  'jwt-null-signature': {
    title: 'JWT 3 · Null signature',
    intro: 'This is not alg:none. The header remains HS256, but the review verifier accepts an empty signature on a synthetic admin claim.',
    action: 'With Full PTK open, press Run paired requests once. Inspect the issued user token, then compare the empty-signature admin request on both verifiers.',
    expected: 'Signed user token: HTTP 403 on both admin routes. Empty-signature admin token: HTTP 200 on vulnerable, HTTP 401 on fixed.',
    reset: 'Stateless: reload or run again. The signing key is process-local and no account changes.',
    evidence: 'Use Full PTK JWT Inspector and Proxy/Request Builder to compare the HS256 header, empty signature and exact HTTP responses. Browser results do not establish a native PTK finding; Auto is unqualified.',
    run: runJwtNullSignature
  },
  'jwt-jwk-injection': {
    title: 'JWT 4 · Embedded JWK injection',
    intro: 'The review verifier trusts a public RSA key embedded in the token header. The repaired verifier ignores it and pins its server key.',
    action: 'With Full PTK open, press Run paired requests once. The browser creates a temporary attacker key and sends the same signed admin token to both verifiers.',
    expected: 'Server-issued user token: HTTP 403 on both admin routes. Attacker-key admin token: HTTP 200 on vulnerable, HTTP 401 on fixed.',
    reset: 'Stateless: reload or run again. Browser and server keypairs are ephemeral; no external key endpoint is contacted.',
    evidence: 'Use Full PTK JWT Inspector and Proxy/Request Builder to inspect the embedded public JWK, signature and responses. This is manual PTK proof pending qualification, not an automatic Full or Auto finding.',
    run: runJwtJwkInjection
  },
  'sql-single-quote': {
    title: 'SQL 1 · Single-quote string literal',
    intro: 'A category value is concatenated inside a real SQLite string literal. The fixed query binds it as data.',
    action: 'Start PTK DAST, then press Run paired requests once to submit a normal category and a single-quote predicate mutation to both routes.',
    expected: 'Normal fruit search returns two products. The mutated review query returns four synthetic products; fixed returns zero.',
    reset: 'Each request creates and closes a fresh in-memory database; press Run again to repeat.',
    evidence: 'Inspect the POST category and actual returned rows in PTK DAST/Proxy. A syntax error alone is not the proof and no native finding is claimed yet.',
    run: (variant) => runSql('single-quote', { category: 'fruit' }, { category: "fruit' OR '1'='1" }, variant)
  },
  'sql-double-quote': {
    title: 'SQL 2 · Double-quote identifier',
    intro: 'An untrusted sort key enters a real SQLite quoted identifier. The repaired route permits only exact sort columns.',
    action: 'Start PTK DAST, then press Run paired requests once to compare the normal sort with a double-quote sort-clause mutation.',
    expected: 'Normal SKU order starts with Apple. The mutated review sort starts with Date; fixed rejects the injected identifier with HTTP 400.',
    reset: 'Each request starts from the same in-memory product rows; press Run again to repeat.',
    evidence: 'Compare the POST sort key and returned order/rejection in PTK Proxy. This is distinct from single-quote string injection.',
    run: (variant) => runSql('double-quote', { sort: 'sku' }, { sort: 'name" DESC, "sku' }, variant)
  },
  'sql-auth-bypass': {
    title: 'SQL 3 · Synthetic login bypass',
    intro: 'A username is concatenated into a real SQLite login predicate. The repaired route binds the same input.',
    action: 'Start PTK DAST, then press Run paired requests once with wrong credentials and the same injected username against both routes.',
    expected: 'Wrong credentials are rejected. The review route grants the synthetic admin identity to the injected input; fixed rejects it.',
    reset: 'No login session is created. Every request uses a new in-memory database; press Run again to repeat.',
    evidence: 'Compare the request and synthetic identity response in PTK DAST/Proxy. The lab never authenticates a real account.',
    run: (variant) => runSql('auth-bypass', { username: 'admin', password: 'incorrect' }, { username: "admin' OR '1'='1", password: 'incorrect' }, variant)
  },
  'xss-reflected': {
    title: 'XSS 1 · Reflected',
    intro: 'The server reflects the query parameter into HTML on the review route. The repaired route encodes it.',
    action: 'Open either target, start PTK, then click Run harmless proof on that target. Repeat the same click on its paired route.',
    expected: 'The review page changes its visible execution marker to executed; the repaired page shows the payload literally and remains not executed.',
    reset: 'Reload either target without its query string. The marker is page-local and no data is stored.',
    evidence: 'Correlate the query source, response body and actual browser execution with PTK DAST/IAST. A browser marker is not itself a PTK finding.',
    review: '/targets/xss/reflected/vulnerable/', fixed: '/targets/xss/reflected/fixed/'
  },
  'xss-dom': {
    title: 'XSS 3 · DOM',
    intro: 'The review script reads the hash and writes it with innerHTML. The repaired script writes the same value as text.',
    action: 'Open either target, start PTK IAST, then click Run harmless proof on that target. Repeat the same click on its paired route.',
    expected: 'Only the review page executes the harmless marker. The repaired page displays the markup-shaped text without executing it.',
    reset: 'Use the Reset link on the target or reload without a hash. No server state changes.',
    evidence: 'Correlate the location.hash source and DOM sink with PTK IAST/SAST. The browser contrast is not an automatic-finding claim.',
    review: '/targets/xss/dom/vulnerable/', fixed: '/targets/xss/dom/fixed/'
  },
  'xss-attribute': {
    title: 'XSS 4 · Reflected HTML attribute',
    intro: 'A server places a query value inside a quoted HTML attribute. The review route fails to encode the quote; the repaired route encodes it.',
    action: 'Open the review target and click Run harmless proof. Repeat the same action on the repaired target.',
    expected: 'The review marker changes to executed after attribute breakout; the repaired marker remains not executed.',
    reset: 'Reload either target without its label query. No data is stored.',
    evidence: 'In Full PTK, compare the label query, response HTML attribute and browser result. Automatic DAST/IAST finding is pending native qualification; Auto is not claimed.',
    review: '/targets/xss/reflected-attribute/vulnerable/', fixed: '/targets/xss/reflected-attribute/fixed/'
  },
  'xss-query-code': {
    title: 'XSS 5 · Query to JavaScript execution',
    intro: 'A client script constructs executable code from a URL query value on the review route. The repaired route displays the same value as text.',
    action: 'Open the review target and click Run harmless proof. Repeat on its repaired pair.',
    expected: 'Only the review route sets the harmless execution marker; repaired displays the code-shaped string without executing it.',
    reset: 'Use Reset on each target. No server state or external endpoint is involved.',
    evidence: 'In Full PTK, inspect the URL query source and JavaScript execution sink in SAST/IAST or use manual source-plus-browser proof. Automatic finding is pending native qualification; Auto is not claimed.',
    review: '/targets/xss/query-code/vulnerable/', fixed: '/targets/xss/query-code/fixed/'
  }
}

const signedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdGstcGxheWdyb3VuZCIsInNjb3BlIjoiZGVtbyJ9.synthetic-signature'
const text = (id, value) => { document.getElementById(id).textContent = value }
const b64 = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function post(url, body, headers = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const result = await response.json()
  return { status: response.status, code: result.code, rows: result.rows, identity: result.identity }
}

async function jwtCarrier(variant, token) {
  const response = await fetch(`/targets/jwt-lab/authorization/${variant}/api/session`, {
    method: 'POST', headers: { 'X-Playground-Request': 'jwt-lab', Authorization: `Bearer ${token}` }
  })
  const result = await response.json()
  return { status: response.status, code: result.code }
}

async function runJwtNone(variant) {
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'ptk-playground', scope: 'demo' })}.`
  if (variant) return { normal: await jwtCarrier(variant, signedToken), unsigned: await jwtCarrier(variant, unsigned) }
  return {
    normalReview: await jwtCarrier('vulnerable', signedToken),
    normalFixed: await jwtCarrier('fixed', signedToken),
    unsignedReview: await jwtCarrier('vulnerable', unsigned),
    unsignedFixed: await jwtCarrier('fixed', unsigned)
  }
}

async function runJwtConfusion(variant) {
  const route = '/api/labs/jwt/confusion/'
  const issueResponse = await fetch(`${route}${variant || 'vulnerable'}`)
  if (!issueResponse.ok) throw new Error(`Synthetic issue request failed: HTTP ${issueResponse.status}`)
  const issued = await issueResponse.json()
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'attendee', role: 'admin', aud: 'ptk-playground' })}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(issued.publicKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)))
  const forged = `${input}.${toBase64Url(signature)}`
  if (variant) return {
    normal: await post(`${route}${variant}`, { token: issued.token }),
    forged: await post(`${route}${variant}`, { token: forged })
  }
  return {
    normalReview: await post(`${route}vulnerable`, { token: issued.token }),
    normalFixed: await post(`${route}fixed`, { token: issued.token }),
    forgedReview: await post(`${route}vulnerable`, { token: forged }),
    forgedFixed: await post(`${route}fixed`, { token: forged })
  }
}

async function issueJwt(kind, variant) {
  const response = await fetch(`/api/labs/jwt/${kind}/${variant || 'vulnerable'}`)
  if (!response.ok) throw new Error(`Synthetic issue request failed: HTTP ${response.status}`)
  return response.json()
}

async function jwtPair(kind, normalToken, forgedToken, variant) {
  const route = `/api/labs/jwt/${kind}/`
  if (variant) return {
    issuedToken: normalToken, forgedToken,
    normal: await post(`${route}${variant}`, { token: normalToken }),
    forged: await post(`${route}${variant}`, { token: forgedToken })
  }
  return {
    issuedToken: normalToken, forgedToken,
    normalReview: await post(`${route}vulnerable`, { token: normalToken }),
    normalFixed: await post(`${route}fixed`, { token: normalToken }),
    forgedReview: await post(`${route}vulnerable`, { token: forgedToken }),
    forgedFixed: await post(`${route}fixed`, { token: forgedToken })
  }
}

async function runJwtNullSignature(variant) {
  const issued = await issueJwt('null-signature', variant)
  const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'attendee', role: 'admin', aud: 'ptk-playground' })}.`
  return jwtPair('null-signature', issued.token, forged, variant)
}

async function runJwtJwkInjection(variant) {
  const issued = await issueJwt('jwk-injection', variant)
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const exported = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const jwk = { kty: 'RSA', n: exported.n, e: exported.e }
  const input = `${b64({ alg: 'RS256', typ: 'JWT', jwk })}.${b64({ sub: 'attendee', role: 'admin', aud: 'ptk-playground' })}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input)))
  return jwtPair('jwk-injection', issued.token, `${input}.${toBase64Url(signature)}`, variant)
}

async function runSql(kind, normal, mutation, variant) {
  const route = `/api/labs/sql/${kind}/`
  if (variant) return {
    normal: await post(`${route}${variant}`, normal),
    mutated: await post(`${route}${variant}`, mutation)
  }
  return {
    normalReview: await post(`${route}vulnerable`, normal),
    normalFixed: await post(`${route}fixed`, normal),
    mutatedReview: await post(`${route}vulnerable`, mutation),
    mutatedFixed: await post(`${route}fixed`, mutation)
  }
}

const name = location.pathname.split('/').filter(Boolean).at(-1)
const selected = cases[name]
const requestedVariant = new URLSearchParams(location.search).get('variant')
const variant = ['vulnerable', 'fixed'].includes(requestedVariant) ? requestedVariant : null
if (!selected) {
  text('lab-title', 'Unknown lab')
} else {
  document.title = `${selected.title} · PTK Playground`
  text('lab-title', selected.title)
  text('lab-intro', selected.intro)
  text('lab-action', selected.action)
  text('lab-expected', selected.expected)
  text('lab-reset', selected.reset)
  text('lab-evidence', selected.evidence)
  if (selected.run) {
    const button = document.getElementById('run-lab')
    button.hidden = false
    if (variant) button.textContent = `Run ${variant === 'vulnerable' ? 'review' : 'repaired'} requests`
    for (const [id, value] of [['review-link', 'vulnerable'], ['fixed-link', 'fixed']]) {
      const link = document.getElementById(id)
      link.href = `?variant=${value}`
      link.hidden = false
    }
    button.addEventListener('click', async () => {
      button.disabled = true
      text('lab-result', 'Sending paired requests…')
      try { text('lab-result', JSON.stringify(await selected.run(variant), null, 2)) }
      catch (error) { text('lab-result', `Runtime unavailable: ${error?.message || 'request failed'}`) }
      finally { button.disabled = false }
    })
  } else {
    for (const [id, href] of [['review-link', selected.review], ['fixed-link', selected.fixed]]) {
      const link = document.getElementById(id)
      link.href = href
      link.hidden = false
    }
    text('lab-result', 'Open a target and click its Run harmless proof link.')
  }
}
