import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function htmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function titleFor(source) {
  return String(source.title || path.basename(source.canonicalPath, '.html'))
    .replace(/^DOM-based test cases\s*[—-]\s*/i, '')
    .replace(/^IAST\s+/i, '')
    .trim()
}

function routeFromFamily(route) {
  return `../${String(route).replace(/^\.\//, '')}`
}

function advancedRoute(source) {
  return `./${path.basename(source.path)}`
}

function caseCard(challenge, index) {
  const operation = challenge.operationKind.replace(/-/g, ' ')
  return `      <article class="family-case-card" data-challenge-id="${htmlText(challenge.id)}">
        <div class="family-case-card__meta"><span>Case ${String(index + 1).padStart(2, '0')}</span><span>${htmlText(operation)}</span></div>
        <h2>${htmlText(challenge.title)}</h2>
        <p>Run this browser-security case independently, then compare it with the behavior-preserving repaired control.</p>
        <div class="button-row">
          <a class="button" href="${htmlText(routeFromFamily(challenge.reviewRoute))}">Open review target</a>
          <a class="button button--secondary" href="${htmlText(routeFromFamily(challenge.repairedRoute))}">Open repaired control</a>
        </div>
      </article>`
}

function pageFor(source, challenges) {
  const engine = source.canonicalPath.startsWith('sast/') ? 'SAST' : 'IAST'
  const engineClass = engine.toLowerCase()
  const title = titleFor(source)
  const description = engine === 'SAST'
    ? 'Review one static browser-code pattern at a time without unrelated findings from the rest of the family.'
    : 'Trigger one live browser runtime flow at a time and compare it with the paired repaired behavior.'
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlText(title)} · ${engine} · OWASP PTK Playground</title>
  <meta name="description" content="Focused ${engine} review and repaired cases for ${htmlText(title)}.">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'">
  <link rel="stylesheet" href="../assets/css/playground.css">
</head>
<body class="engine-page engine-page--${engineClass} family-directory-page" data-family-directory="${htmlText(source.canonicalPath)}">
  <a class="skip-link" href="#cases">Skip to cases</a>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="../"><span class="brand__mark" aria-hidden="true">PTK</span><span>OWASP PTK Playground</span></a>
      <nav class="site-nav" aria-label="Playground navigation"><a href="../play/">Play</a><a href="../explore/?engine=${engine}">Explore ${engine}</a></nav>
    </div>
  </header>
  <main class="page-shell">
    <section class="engine-hero family-hero">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="../">Playground</a><span aria-hidden="true">/</span><a href="./">${engine}</a><span aria-hidden="true">/</span><span>${htmlText(title)}</span></nav>
      <p class="eyebrow">${engine} case family</p>
      <h1>${htmlText(title)}</h1>
      <p class="engine-hero__lede">${description}</p>
      <div class="family-hero__facts" aria-label="Family summary"><span><strong>${challenges.length}</strong> focused cases</span><span><strong>${challenges.length}</strong> repaired controls</span></div>
    </section>
    <aside class="notice notice--engine" aria-label="How to use this family">
      <span class="notice__icon" aria-hidden="true">${engine === 'SAST' ? '{}' : '↯'}</span>
      <p><strong>Choose a single case.</strong> Start the relevant PTK engine, open its review target and perform the prepared action when one is shown. Use the repaired control to verify that normal behavior remains while the unsafe boundary is removed.</p>
    </aside>
    <section id="cases" class="section" aria-labelledby="cases-title">
      <div class="section-heading"><div><p class="eyebrow">Focused targets</p><h2 id="cases-title">One page per unique case</h2></div></div>
      <div class="family-case-grid">
${challenges.map(caseCard).join('\n')}
      </div>
    </section>
    <aside class="advanced-lab-panel">
      <div><p class="eyebrow">Compatibility lab</p><h2>Need every historical case on one page?</h2><p>The combined lab is retained for regression and scanner-compatibility work. It is deliberately denser than the focused playground journey.</p></div>
      <a class="button button--secondary" href="${htmlText(advancedRoute(source))}">Open Advanced combined lab</a>
    </aside>
  </main>
  <footer class="site-footer"><div class="site-footer__inner"><p>${engine} family directory · scanner-neutral review and repaired targets.</p><nav aria-label="Project links"><a href="../play/">Play</a><a href="../explore/?engine=${engine}">Explore ${engine}</a><a href="https://owasp.org/www-project-penetration-testing-kit/">OWASP PTK</a></nav></div></footer>
</body>
</html>
`
}

function publish(relativePath, content) {
  const absolute = path.join(repoRoot, relativePath)
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) {
      throw new Error(`${relativePath} is stale; run npm run catalog:generate`)
    }
    return
  }
  fs.writeFileSync(absolute, content)
}

const ledger = readJson('catalog/source-ledger.json')
const atomic = [readJson('catalog/sast-atomic.json'), readJson('catalog/iast-atomic.json')]
  .flatMap((document) => document.challenges)
const challengesBySource = new Map()
for (const challenge of atomic) {
  const list = challengesBySource.get(challenge.sourcePath) || []
  list.push(challenge)
  challengesBySource.set(challenge.sourcePath, list)
}

const sources = ledger.sources
  .filter((source) => source.role === 'legacy-aggregate' && source.canonicalPath && /^(?:sast|iast)\//.test(source.canonicalPath))
  .sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath))

for (const source of sources) {
  const scenarioOrder = new Map((source.scenarios || []).map((scenario, index) => [scenario.id, index]))
  const challenges = (challengesBySource.get(source.canonicalPath) || [])
    .sort((left, right) => (scenarioOrder.get(left.sourceScenarioId) ?? Number.MAX_SAFE_INTEGER)
      - (scenarioOrder.get(right.sourceScenarioId) ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id))
  if (challenges.length === 0) throw new Error(`family has no atomic challenges: ${source.canonicalPath}`)
  if (new Set(challenges.map((challenge) => challenge.sourceScenarioId)).size !== challenges.length) {
    throw new Error(`family contains duplicate source scenarios: ${source.canonicalPath}`)
  }
  publish(source.canonicalPath, pageFor(source, challenges))
}

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', directories: sources.length }))
