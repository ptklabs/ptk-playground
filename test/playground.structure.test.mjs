import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const catalog = readJson('catalog/cases.json')
const missions = readJson('catalog/missions.json')
const scannerTargets = readJson('catalog/scanner-targets.json')
const demo = readJson('catalog/demo.json')
const sourceLedger = readJson('catalog/source-ledger.json')
const legacyRoutes = readJson('catalog/legacy-routes.json')
const canonicalChallenges = readJson('catalog/challenges.json')
const canonicalFamilies = readJson('catalog/families.json')
const canonicalPlaylists = readJson('catalog/playlists.json')
const atomicSast = readJson('catalog/sast-atomic.json')
const atomicIast = readJson('catalog/iast-atomic.json')
const dastContracts = readJson('catalog/dast-contracts.json')
const scaDependencies = readJson('catalog/sca-dependencies.json')
const generatedScannerTargets = readJson('catalog/generated/scanner-targets.json')
const generatedCounts = readJson('catalog/generated/counts.json')

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex')
}

function assertAtomicWorkbench(markup, engine, variant) {
  assert.match(markup, new RegExp(`class="target-page engine-page engine-page--${engine.toLowerCase()}"`))
  assert.match(markup, new RegExp(`data-variant="${variant}"`))
  assert.match(markup, /class="site-header atomic-site-header"/)
  assert.match(markup, /class="atomic-hero atomic-hero--(?:review|fixed)"/)
  assert.match(markup, /class="atomic-steps"/)
  assert.match(markup, /class="atomic-workbench"/)
  assert.match(markup, /class="atomic-panel atomic-panel--input"/)
  assert.match(markup, /class="atomic-panel atomic-panel--evidence"/)
  assert.match(markup, /class="atomic-pair-note atomic-pair-note--(?:review|fixed)"/)
  assert.match(markup, /Open Advanced source/)
  assert.match(markup, variant === 'review' ? /Open repaired control/ : /Open review target/)
}

test('full-corpus source ledger is current and accounts for every selected source file', () => {
  assert.equal(sourceLedger.schema, 'owasp-ptk-playground-source-ledger/v1')
  assert.equal(sourceLedger.version, 1)
  assert.equal(sourceLedger.referenceCorpus.commit, '76cabc61a9552186588a6bf11a9ec680eea73e02')
  assert.deepEqual(sourceLedger.inventoryRoots, [
    'sast',
    'iast',
    'passive',
    'campaigns',
    'demo',
    'scanner',
    'play',
    'explore',
    'jwt',
    'labs',
    'atomic',
    'targets',
    'assets/css',
    'assets/js',
    'assets/vendor'
  ])

  execFileSync(process.execPath, ['scripts/build-corpus-ledger.mjs', '--check'], {
    cwd: repoRoot,
    stdio: 'pipe'
  })
  execFileSync(process.execPath, ['scripts/build-canonical-catalog.mjs', '--check'], {
    cwd: repoRoot,
    stdio: 'pipe'
  })

  const discoveredPaths = sourceLedger.inventoryRoots
    .flatMap((relativeRoot) => walk(path.join(repoRoot, relativeRoot)))
    .map((absolute) => path.relative(repoRoot, absolute).split(path.sep).join('/'))
    .filter((relative) => !/(?:^|\/)\.DS_Store$/.test(relative))
    .sort()
  const ledgerPaths = sourceLedger.sources.map((source) => source.path)

  assert.deepEqual(ledgerPaths, discoveredPaths)
  assert.equal(sourceLedger.summary.sourceFiles, sourceLedger.sources.length)
  assert.equal(new Set(ledgerPaths).size, ledgerPaths.length)
  assert.equal(new Set(sourceLedger.sources.map((source) => source.id)).size, sourceLedger.sources.length)
  assert.equal(sourceLedger.summary.migrationComplete, true, 'every authored assertion should have an atomic target or runtime contract')
  assert.equal(sourceLedger.summary.authoredSourceFiles + sourceLedger.summary.generatedAtomicFiles, sourceLedger.summary.sourceFiles)

  const dispositions = new Set([
    'migrate-atomic',
    'retain-aggregate',
    'helper-only',
    'index-only'
  ])
  let scenarioCount = 0
  for (const source of sourceLedger.sources) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/)
    assert.equal(source.sha256, sha256(source.path), `stale source hash: ${source.path}`)
    assert.ok(dispositions.has(source.disposition), `unknown disposition: ${source.path}`)
    assert.ok(['reviewed', 'pending-manual'].includes(source.reviewStatus), `invalid review status: ${source.path}`)
    if (source.role === 'legacy-aggregate') {
      assert.equal(source.disposition, 'retain-aggregate')
      assert.equal(source.reviewStatus, 'reviewed')
      assert.ok(source.scenarios?.length > 0, `legacy aggregate has no scenario candidate: ${source.path}`)
    }
    for (const scenario of source.scenarios || []) {
      assert.ok(scenario.id.startsWith('source.'))
      assert.ok(scenario.label)
      assert.ok(scenario.locator)
      assert.ok(['reviewed', 'pending-manual'].includes(scenario.reviewStatus))
      scenarioCount += 1
    }
  }
  assert.equal(sourceLedger.summary.scenarios.total, scenarioCount)
  assert.equal(sourceLedger.summary.scenarios.pendingManual, 0)
  assert.equal(sourceLedger.summary.scenarios.reviewed, sourceLedger.summary.scenarios.total)
  assert.equal(sourceLedger.summary.scenarios.absorbedTriggers, 33)
  assert.equal(sourceLedger.summary.scenarios.reviewedMarkers, sourceLedger.summary.scenarios.total + 33)
  assert.equal(sourceLedger.summary.scenarios.retainedAggregateAssertions, 0)

  for (const uncatalogued of [
    'sast/append_child copy.html',
    'sast/dom_data_manipulation copy.html',
    'sast/test.html'
  ]) {
    const source = sourceLedger.sources.find((entry) => entry.canonicalPath === uncatalogued)
    assert.ok(source, `uncatalogued historical source is missing: ${uncatalogued}`)
    assert.equal(source.role, 'legacy-aggregate')
    assert.equal(source.path, uncatalogued.replace(/\.html$/, '.advanced.html'))
    assert.ok(!source.catalogCaseIds, `${uncatalogued} was silently assigned to a catalogue case`)
  }
})

test('SAST and IAST family URLs list unique atomics while retaining combined Advanced labs', () => {
  const atomics = [...atomicSast.challenges, ...atomicIast.challenges]
  const advancedSources = sourceLedger.sources.filter((source) =>
    source.role === 'legacy-aggregate' && source.canonicalPath && /^(?:sast|iast)\//.test(source.canonicalPath)
  )
  assert.equal(advancedSources.length, 64)

  for (const source of advancedSources) {
    const directory = sourceLedger.sources.find((candidate) => candidate.path === source.canonicalPath)
    assert.ok(directory, `family directory is absent: ${source.canonicalPath}`)
    assert.equal(directory.role, 'family-directory')
    assert.ok(!directory.scenarios, `family directory contains executable scenarios: ${source.canonicalPath}`)
    const markup = read(source.canonicalPath)
    assert.match(markup, /data-family-directory=/)
    assert.match(markup, new RegExp(path.basename(source.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const challenges = atomics.filter((challenge) => challenge.sourcePath === source.canonicalPath)
    const assertions = (source.scenarios || []).filter((scenario) => scenario.role === 'assertion')
    assert.equal(challenges.length, assertions.length, `family count drift: ${source.canonicalPath}`)
    assert.equal(new Set(challenges.map((challenge) => challenge.sourceScenarioId)).size, challenges.length)
    for (const challenge of challenges) {
      assert.ok(markup.includes(`href="../${challenge.reviewRoute.replace(/^\.\//, '')}"`), `review link is absent: ${challenge.id}`)
      assert.ok(markup.includes(`href="../${challenge.repairedRoute.replace(/^\.\//, '')}"`), `control link is absent: ${challenge.id}`)
    }
  }

  const appendCases = atomicSast.challenges.filter((challenge) => challenge.sourcePath === 'sast/append_child.html')
  assert.equal(appendCases.length, 4)
  assert.ok(!appendCases.some((challenge) => /button-[23]-/.test(challenge.id)), 'nested appendChild trigger was counted twice')
  const appendSource = advancedSources.find((source) => source.canonicalPath === 'sast/append_child.html')
  assert.equal(appendSource.scenarios.flatMap((scenario) => scenario.absorbedTriggers || []).length, 2)
  const clobberCases = atomicIast.challenges.filter((challenge) => challenge.sourcePath === 'iast/iast_dom_clobbering.html')
  assert.equal(clobberCases.length, 2, 'standalone IAST DOM-clobbering actions must remain distinct')
})

test('every classified historical IAST assertion has a separate generated review and repaired target', () => {
  assert.equal(atomicIast.schema, 'owasp-ptk-playground-atomic-iast/v1')
  const expected = sourceLedger.sources
    .filter((source) => source.role === 'legacy-aggregate' && source.path.startsWith('iast/'))
    .flatMap((source) => (source.scenarios || []).filter((scenario) => scenario.role === 'assertion'))
  assert.equal(atomicIast.summary.challenges, expected.length)
  assert.equal(atomicIast.summary.pairedTargets, expected.length * 2)
  assert.ok(new Set(atomicIast.challenges.map((entry) => entry.operationKind)).size >= 35)
  assert.ok(atomicIast.challenges.every((entry) => entry.operationKind && entry.operationKind !== 'runtime-boundary'))
  assert.deepEqual(atomicIast.challenges.map((entry) => entry.sourceScenarioId).sort(), expected.map((entry) => entry.id).sort())
  for (const challenge of atomicIast.challenges) {
    const reviewDirectory = challenge.reviewRoute.replace(/^\.\//, '')
    const repairedDirectory = challenge.repairedRoute.replace(/^\.\//, '')
    const reviewScript = read(`${reviewDirectory}case.js`)
    const repairedScript = read(`${repairedDirectory}case.js`)
    assertAtomicWorkbench(read(`${reviewDirectory}index.html`), 'IAST', 'review')
    assertAtomicWorkbench(read(`${repairedDirectory}index.html`), 'IAST', 'fixed')
    assert.notEqual(reviewScript, repairedScript, `review/control scripts are identical: ${challenge.id}`)
    assert.doesNotThrow(() => new vm.Script(reviewScript, { filename: `${challenge.id}:review` }))
    assert.doesNotThrow(() => new vm.Script(repairedScript, { filename: `${challenge.id}:fixed` }))
    assert.doesNotMatch(reviewScript + repairedScript, /https?:\/\//i, `generated IAST case has an external URL: ${challenge.id}`)
  }
})

test('DAST contract catalogue classifies every route-aware endpoint and keeps active requests bounded', () => {
  assert.equal(dastContracts.schema, 'owasp-ptk-playground-dast-contracts/v1')
  const runtimeRoutes = legacyRoutes.routes.filter((route) => route.kinds.includes('route-aware-runtime')).map((route) => route.path).sort()
  assert.deepEqual(dastContracts.contracts.map((contract) => contract.route).sort(), runtimeRoutes)
  assert.equal(dastContracts.summary.runtimeRoutes, runtimeRoutes.length)
  assert.equal(dastContracts.summary.runtimeRoutes, dastContracts.summary.securityTargets + dastContracts.summary.infrastructureRoutes)
  for (const contract of dastContracts.contracts) {
    assert.ok(contract.route.startsWith('/') && !contract.route.startsWith('//'))
    assert.ok(['assertion', 'control', 'infrastructure'].includes(contract.role))
    assert.ok(['security-target', 'runtime-support'].includes(contract.disposition))
    assert.equal(contract.runtime.loopbackOnly, true)
    assert.ok(contract.methods.length > 0)
    if (contract.controlRoute) {
      assert.notEqual(contract.route, contract.controlRoute)
      assert.ok(dastContracts.contracts.some((candidate) => candidate.route === contract.controlRoute && candidate.role === 'control'))
    }
  }
  const active = dastContracts.contracts.find((contract) => contract.route === '/targets/session-bound-order-search/vulnerable/api/search')
  assert.deepEqual(active.methods, ['POST'])
  assert.equal(active.runtime.protocol, 'https')
  assert.equal(active.controlRoute, '/targets/session-bound-order-search/fixed/api/search')
  assert.match(read('passive/server.mjs'), /request_body_too_large/)

  const jwtCarriers = ['authorization', 'cookie', 'form', 'json']
  for (const carrier of jwtCarriers) {
    const reviewRoute = `/targets/jwt-lab/${carrier}/vulnerable/api/session`
    const fixedRoute = `/targets/jwt-lab/${carrier}/fixed/api/session`
    const review = dastContracts.contracts.find((contract) => contract.route === reviewRoute)
    const fixed = dastContracts.contracts.find((contract) => contract.route === fixedRoute)
    assert.ok(review, `JWT review contract missing: ${carrier}`)
    assert.ok(fixed, `JWT control contract missing: ${carrier}`)
    assert.deepEqual(review.methods, ['POST'])
    assert.equal(review.controlRoute, fixedRoute)
    assert.equal(review.runtime.loopbackOnly, true)
    assert.equal(fixed.role, 'control')
  }

  const publicJwtSources = [
    read('jwt/index.html'),
    read('targets/jwt-lab/dast/index.html'),
    read('assets/js/jwt-storage-lab.js'),
    read('assets/js/jwt-dast-lab.js')
  ].join('\n')
  assert.doesNotMatch(publicJwtSources, /jwt_scenario_|jwtCarrierProof|jwtCarrierBaseline/)
  const runtimeSource = read('passive/server.mjs')
  assert.match(runtimeSource, /no file was read/)
  assert.match(runtimeSource, /no network request was made/)
})

test('SCA catalogue pins every public dependency and provides a paired browser control', () => {
  assert.equal(scaDependencies.schema, 'owasp-ptk-playground-sca-dependencies/v1')
  assert.equal(scaDependencies.summary.packages, scaDependencies.packages.length)
  assert.equal(scaDependencies.summary.scenarios, scaDependencies.scenarios.length)
  assert.equal(scaDependencies.summary.pairedControls, scaDependencies.scenarios.length)
  for (const dependency of scaDependencies.packages) {
    assert.ok(fs.existsSync(path.join(repoRoot, dependency.provenanceFile.replace(/^\.\//, ''))))
    assert.ok(fs.existsSync(path.join(repoRoot, dependency.licenseFile.replace(/^\.\//, ''))))
  }
  for (const scenario of scaDependencies.scenarios) {
    assert.ok(scenario.review.targetRoute.startsWith('./'))
    assert.ok(scenario.repaired.targetRoute.startsWith('./'))
    assert.ok(fs.existsSync(path.join(repoRoot, scenario.review.targetRoute.replace(/^\.\//, ''), 'index.html')))
    assert.ok(fs.existsSync(path.join(repoRoot, scenario.repaired.targetRoute.replace(/^\.\//, ''), 'index.html')))
    const reviewResource = scenario.review.resourceRoute.replace(/^\.\//, '')
    assert.equal(sha256(reviewResource), scenario.review.sha256)
    if (scenario.repaired.resourceRoute) assert.equal(sha256(scenario.repaired.resourceRoute.replace(/^\.\//, '')), scenario.repaired.sha256)
  }
  const angularReview = read('targets/angular-expression-dependency/review/index.html')
  const angularControl = read('targets/angular-expression-dependency/fixed/index.html')
  assert.match(angularReview, /assets\/vendor\/angularjs\/angular\.min\.js/)
  assert.doesNotMatch(angularControl, /assets\/vendor\/angularjs\/angular\.min\.js/)
})

test('every classified historical SAST assertion has a separate generated review and repaired target', () => {
  assert.equal(atomicSast.schema, 'owasp-ptk-playground-atomic-sast/v1')
  assert.equal(atomicSast.version, 1)
  const expected = sourceLedger.sources
    .filter((source) => source.role === 'legacy-aggregate' && source.path.startsWith('sast/'))
    .flatMap((source) => (source.scenarios || []).filter((scenario) => scenario.role === 'assertion'))
  assert.equal(atomicSast.summary.challenges, expected.length)
  assert.equal(atomicSast.summary.pairedTargets, expected.length * 2)
  assert.ok(new Set(atomicSast.challenges.map((entry) => entry.operationKind)).size >= 30)
  assert.ok(atomicSast.challenges.every((entry) => entry.operationKind))
  assert.equal(new Set(atomicSast.challenges.map((entry) => entry.id)).size, atomicSast.challenges.length)
  assert.deepEqual(
    atomicSast.challenges.map((entry) => entry.sourceScenarioId).sort(),
    expected.map((scenario) => scenario.id).sort()
  )

  for (const challenge of atomicSast.challenges) {
    assert.ok(challenge.reviewRoute.startsWith('./atomic/sast/'))
    assert.ok(challenge.repairedRoute.startsWith('./atomic/sast/'))
    assert.notEqual(challenge.reviewRoute, challenge.repairedRoute)
    const reviewDirectory = challenge.reviewRoute.replace(/^\.\//, '')
    const repairedDirectory = challenge.repairedRoute.replace(/^\.\//, '')
    const reviewHtml = read(`${reviewDirectory}index.html`)
    const repairedHtml = read(`${repairedDirectory}index.html`)
    const reviewScript = read(`${reviewDirectory}case.js`)
    const repairedScript = read(`${repairedDirectory}case.js`)
    assertAtomicWorkbench(reviewHtml, 'SAST', 'review')
    assertAtomicWorkbench(repairedHtml, 'SAST', 'fixed')
    assert.equal((reviewHtml.match(/<script\b/g) || []).length, 1)
    assert.equal((repairedHtml.match(/<script\b/g) || []).length, 1)
    assert.notEqual(reviewScript, repairedScript, `review/control scripts are identical: ${challenge.id}`)
    assert.doesNotMatch(reviewHtml + repairedHtml + reviewScript + repairedScript, /<script[^>]+src=["']https?:|import\s*\([^)]*https?:/i)
    assert.doesNotThrow(() => new vm.Script(reviewScript, { filename: `${challenge.id}:review` }))
    assert.doesNotThrow(() => new vm.Script(repairedScript, { filename: `${challenge.id}:fixed` }))
  }


  const requestHeader = atomicSast.challenges.find((entry) => entry.id.includes('arh-setrequestheader'))
  assert.ok(requestHeader)
  const requestHeaderMarkup = read(`${requestHeader.reviewRoute.replace(/^\.\//, '')}index.html`)
  assert.match(requestHeaderMarkup, /id="case-link"[^>]+hidden/)
  assert.match(requestHeaderMarkup, /id="preview"[^>]+hidden/)
})

test('canonical registry accounts for the full legacy catalogue and uncatalogued aggregate sources', () => {
  assert.equal(canonicalChallenges.schema, 'owasp-ptk-playground-challenges/v1')
  assert.equal(canonicalChallenges.version, 1)
  assert.equal(canonicalChallenges.migrationStatus, 'full-corpus-fixtures-complete')
  assert.equal(canonicalChallenges.summary.legacyCatalogueCases, catalog.cases.length)
  assert.equal(canonicalChallenges.summary.sourceLedgerFiles, sourceLedger.sources.length)
  assert.equal(canonicalChallenges.summary.authoredSourceFiles, sourceLedger.summary.authoredSourceFiles)
  assert.equal(canonicalChallenges.summary.generatedAtomicSast, atomicSast.summary.challenges)
  assert.equal(canonicalChallenges.summary.generatedAtomicIast, atomicIast.summary.challenges)
  assert.equal(canonicalChallenges.summary.dastRuntimeRoutes, dastContracts.summary.runtimeRoutes)
  assert.equal(canonicalChallenges.summary.scaScenarios, scaDependencies.summary.scenarios)
  assert.equal(canonicalChallenges.summary.classifiedScenarioMarkers, sourceLedger.summary.scenarios.reviewedMarkers)
  assert.equal(canonicalChallenges.summary.retainedAggregateAssertions, sourceLedger.summary.scenarios.retainedAggregateAssertions)
  assert.equal(canonicalChallenges.summary.pendingScenarioReview, sourceLedger.summary.scenarios.pendingManual)
  assert.equal(canonicalChallenges.summary.challenges, canonicalChallenges.challenges.length)

  const challengeIds = new Set()
  const representedCaseIds = []
  const representedSourceIds = new Set()
  for (const challenge of canonicalChallenges.challenges) {
    assert.ok(challenge.id && !challengeIds.has(challenge.id), `duplicate canonical challenge: ${challenge.id}`)
    challengeIds.add(challenge.id)
    assert.ok(['atomic-challenge', 'atomic-observation', 'advanced-lab'].includes(challenge.kind), `unknown challenge kind: ${challenge.id}`)
    assert.ok(challenge.title && challenge.summary && challenge.category)
    assert.ok(Array.isArray(challenge.engines) && challenge.engines.length > 0)
    assert.ok(challenge.familyId)
    assert.ok(challenge.targets?.review?.route, `challenge has no review route: ${challenge.id}`)
    assert.ok(
      challenge.targets.review.route.startsWith('./') || challenge.targets.review.route.startsWith('/'),
      `challenge route is not local: ${challenge.id}`
    )
    assert.ok(!challenge.targets.review.route.startsWith('//'))
    for (const legacyCaseId of challenge.provenance.legacyCaseIds || []) representedCaseIds.push(legacyCaseId)
    for (const sourceId of challenge.provenance.sourceIds || []) representedSourceIds.add(sourceId)
  }
  for (const entry of atomicSast.challenges) {
    const canonical = canonicalChallenges.challenges.find((challenge) => challenge.id === entry.id)
    assert.ok(canonical, `generated SAST challenge is absent from canonical registry: ${entry.id}`)
    assert.equal(canonical.kind, 'atomic-challenge')
    assert.equal(canonical.targets.review.route, entry.reviewRoute)
    assert.equal(canonical.targets.repaired.route, entry.repairedRoute)
  }

  const atomicBySource = new Map()
  for (const challenge of canonicalChallenges.challenges.filter((entry) => entry.kind !== 'advanced-lab')) {
    for (const sourceId of challenge.provenance.sourceIds || []) {
      const ids = atomicBySource.get(sourceId) || []
      ids.push(challenge.id)
      atomicBySource.set(sourceId, ids)
    }
  }
  for (const challenge of canonicalChallenges.challenges.filter((entry) => entry.kind === 'advanced-lab')) {
    assert.equal(challenge.migrationStatus, 'compatibility-lab', `stale Advanced status: ${challenge.id}`)
    assert.doesNotMatch(challenge.summary, /awaiting complete|pending (?:split|classification)/i)
    const expected = [...new Set((challenge.provenance.sourceIds || []).flatMap((sourceId) => atomicBySource.get(sourceId) || []))].sort()
    assert.deepEqual(challenge.provenance.derivedChallengeIds, expected, `Advanced child mapping drift: ${challenge.id}`)
  }

  for (const mission of missions.missions) {
    const challenge = canonicalChallenges.challenges.find((entry) => entry.id === mission.id)
    assert.deepEqual(challenge.guidance, {
      route: mission.route,
      objectiveCount: mission.objectives.length,
      supportsProgress: true,
      supportsHints: true,
      supportsProofTokens: mission.objectives.some((objective) => objective.completion?.type === 'proof')
    })
  }

  assert.deepEqual(representedCaseIds.sort(), catalog.cases.map((entry) => entry.id).sort())
  for (const source of sourceLedger.sources.filter((entry) => entry.role === 'legacy-aggregate')) {
    assert.ok(representedSourceIds.has(source.id), `legacy source is absent from canonical registry: ${source.path}`)
  }
  for (const expected of [
    'legacy.sast-append-child-copy',
    'legacy.sast-dom-data-manipulation-copy',
    'legacy.sast-test'
  ]) {
    assert.ok(challengeIds.has(expected), `uncatalogued source challenge is absent: ${expected}`)
  }
})

test('canonical families and playlists reference challenges without copying challenge contracts', () => {
  assert.equal(canonicalFamilies.schema, 'owasp-ptk-playground-families/v1')
  assert.equal(canonicalPlaylists.schema, 'owasp-ptk-playground-playlists/v1')
  const challengesById = new Map(canonicalChallenges.challenges.map((challenge) => [challenge.id, challenge]))
  const familyIds = new Set()
  const familyMembership = new Map()

  for (const family of canonicalFamilies.families) {
    assert.ok(family.id && !familyIds.has(family.id), `duplicate family: ${family.id}`)
    familyIds.add(family.id)
    assert.ok(family.title)
    assert.ok(Array.isArray(family.challengeIds) && family.challengeIds.length > 0)
    for (const challengeId of family.challengeIds) {
      assert.ok(challengesById.has(challengeId), `family references unknown challenge: ${challengeId}`)
      assert.ok(!familyMembership.has(challengeId), `challenge appears in multiple families: ${challengeId}`)
      familyMembership.set(challengeId, family.id)
    }
  }
  for (const challenge of canonicalChallenges.challenges) {
    assert.equal(familyMembership.get(challenge.id), challenge.familyId, `challenge family mismatch: ${challenge.id}`)
  }

  const playlistIds = new Set()
  for (const playlist of canonicalPlaylists.playlists) {
    assert.ok(playlist.id && !playlistIds.has(playlist.id), `duplicate playlist: ${playlist.id}`)
    playlistIds.add(playlist.id)
    assert.ok(playlist.title && playlist.summary)
    assert.ok(Array.isArray(playlist.challengeIds) && playlist.challengeIds.length > 0)
    assert.deepEqual(
      Object.keys(playlist).sort(),
      ['challengeIds', 'durationMinutes', 'id', 'summary', 'title'].filter((field) => playlist[field] !== undefined).sort(),
      `playlist duplicates challenge data: ${playlist.id}`
    )
    for (const challengeId of playlist.challengeIds) {
      assert.ok(challengesById.has(challengeId), `playlist references unknown challenge: ${challengeId}`)
    }
  }
  assert.deepEqual(
    canonicalPlaylists.playlists.find((playlist) => playlist.id === 'browser-context-demo').challengeIds,
    demo.chapters.map((chapter) => chapter.missionId)
  )
})

test('generated scanner feed is a complete neutral projection of canonical targets', () => {
  assert.equal(generatedScannerTargets.schema, 'owasp-ptk-playground-scanner-targets/v2')
  assert.equal(generatedScannerTargets.generatedFrom, 'catalog/challenges.json')
  const expectedTargets = canonicalChallenges.challenges.reduce((total, challenge) => total + (challenge.targets.repaired ? 2 : 1), 0)
  assert.equal(generatedScannerTargets.summary.challenges, canonicalChallenges.challenges.length)
  assert.equal(generatedScannerTargets.summary.targets, expectedTargets)
  assert.equal(generatedScannerTargets.targets.length, expectedTargets)
  assert.equal(new Set(generatedScannerTargets.targets.map((target) => target.id)).size, generatedScannerTargets.targets.length)
  for (const target of generatedScannerTargets.targets) {
    assert.ok(['review', 'repaired'].includes(target.variant))
    assert.ok(canonicalChallenges.challenges.some((challenge) => challenge.id === target.challengeId))
    assert.ok(target.route.startsWith('./') || target.route.startsWith('/'))
    assert.ok(!target.route.startsWith('//'))
    assert.ok(target.engines.length > 0)
    assert.ok(!Object.hasOwn(target, 'productPreview'))
  }
  assert.equal(generatedCounts.schema, 'owasp-ptk-playground-counts/v1')
  assert.equal(generatedCounts.targets, expectedTargets)
  assert.equal(generatedCounts.migration.sourceMigrationComplete, true)
  assert.equal(generatedCounts.migration.pendingScenarioReview, 0)
  assert.equal(generatedCounts.migration.retainedAggregateAssertions, 0)
})

test('frozen route inventory accounts for static, catalogue, mission and runtime routes', () => {
  assert.equal(legacyRoutes.schema, 'owasp-ptk-playground-legacy-routes/v1')
  assert.equal(legacyRoutes.version, 1)
  assert.equal(legacyRoutes.summary.routes, legacyRoutes.routes.length)
  assert.equal(new Set(legacyRoutes.routes.map((entry) => entry.path)).size, legacyRoutes.routes.length)
  assert.ok(legacyRoutes.summary.runtimeRoutes > 0)

  for (const route of legacyRoutes.routes) {
    assert.ok(route.path.startsWith('/') && !route.path.startsWith('//'), `non-local frozen route: ${route.path}`)
    assert.ok(route.kinds.length > 0, `frozen route has no kind: ${route.path}`)
    assert.ok(route.owners.length > 0, `frozen route has no owner: ${route.path}`)
  }

  for (const expected of [
    '/sast/inner_html.html',
    '/iast/iast_dom_xss.html',
    '/passive/cases/headers/powered-by.html',
    '/targets/support-widget/vulnerable/',
    '/targets/session-bound-order-search/vulnerable/api/search',
    '/campaigns/transient-route-notice/'
  ]) {
    assert.ok(legacyRoutes.routes.some((route) => route.path === expected), `frozen route is missing: ${expected}`)
  }
})

test('public catalogue has unique, local, minimally valid cases', () => {
  assert.equal(catalog.schema, 'owasp-ptk-playground-catalog/v1')
  assert.equal(catalog.version, 1)
  assert.ok(Array.isArray(catalog.cases) && catalog.cases.length > 0)

  const ids = new Set()
  const engines = new Set(['sast', 'iast', 'dast-passive'])
  for (const entry of catalog.cases) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(entry.id.length > 3)
    assert.ok(!ids.has(entry.id), `duplicate case id: ${entry.id}`)
    ids.add(entry.id)
    assert.ok(engines.has(entry.engine), `unknown engine for ${entry.id}`)
    assert.ok(!Object.hasOwn(entry, 'edition'), `public case must not expose product edition: ${entry.id}`)
    assert.ok(Array.isArray(entry.mode) && entry.mode.length > 0, `missing mode for ${entry.id}`)
    assert.equal(typeof entry.route, 'string')
    assert.ok(entry.route.startsWith('./') || entry.route.startsWith('/'), `case route must be local: ${entry.id}`)
    assert.ok(!entry.route.startsWith('//'), `protocol-relative route is forbidden: ${entry.id}`)
  }
  for (const engine of engines) {
    assert.ok(catalog.cases.some((entry) => entry.engine === engine), `catalogue has no ${engine} cases`)
  }
})

test('public catalogue contains no executable PTK rulepack fields', () => {
  const forbidden = new Set([
    'attacks', 'rules', 'payloads', 'constants', 'validation', 'matcher', 'matchers',
    'execution', 'requestTemplate', 'requestTemplates', 'moduleId', 'ruleId', 'ruleIds',
    'policy', 'policyId', 'hookPolicy'
  ])
  function inspect(value, location = 'catalog') {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${location}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `forbidden public catalogue field ${location}.${key}`)
      inspect(entry, `${location}.${key}`)
    }
  }
  inspect(catalog)
  inspect(missions, 'missions')
  inspect(scannerTargets, 'scannerTargets')
  inspect(demo, 'demo')
  inspect(canonicalChallenges, 'canonicalChallenges')
  inspect(canonicalFamilies, 'canonicalFamilies')
  inspect(canonicalPlaylists, 'canonicalPlaylists')
  inspect(sourceLedger, 'sourceLedger')
  inspect(legacyRoutes, 'legacyRoutes')
  inspect(atomicSast, 'atomicSast')
  inspect(atomicIast, 'atomicIast')
  inspect(dastContracts, 'dastContracts')
  inspect(scaDependencies, 'scaDependencies')
  inspect(generatedScannerTargets, 'generatedScannerTargets')
  inspect(generatedCounts, 'generatedCounts')
})

test('curated demo references existing missions and covers every evidence family once as a coherent journey', () => {
  assert.equal(demo.schema, 'owasp-browser-security-demo/v1')
  assert.equal(demo.version, 1)
  assert.equal(demo.id, 'browser-context')
  assert.equal(demo.durationMinutes, 12)
  assert.equal(demo.chapters.length, 3)
  assert.deepEqual(demo.chapters.map((chapter) => chapter.missionId), [
    'support-widget',
    'session-bound-order-search',
    'transient-route-notice'
  ])
  assert.equal(demo.chapters.reduce((total, chapter) => total + chapter.durationMinutes, 0), demo.durationMinutes)

  const missionById = new Map(missions.missions.map((mission) => [mission.id, mission]))
  const coveredEngines = new Set()
  const chapterIds = new Set()
  for (const [index, chapter] of demo.chapters.entries()) {
    assert.equal(chapter.number, index + 1)
    assert.ok(chapter.id && !chapterIds.has(chapter.id), `duplicate demo chapter: ${chapter.id}`)
    chapterIds.add(chapter.id)
    const mission = missionById.get(chapter.missionId)
    assert.ok(mission, `demo references an unknown mission: ${chapter.missionId}`)
    mission.engines.forEach((engine) => coveredEngines.add(engine))
    assert.ok(Array.isArray(chapter.presenterSteps) && chapter.presenterSteps.length === 3)
    assert.ok(Array.isArray(chapter.evidence) && chapter.evidence.length > 0)
    assert.ok(chapter.browserAdvantage)
    const optionValues = chapter.checkpoint.options.map((option) => option.value)
    assert.equal(new Set(optionValues).size, optionValues.length)
    assert.ok(optionValues.includes(chapter.checkpoint.answer))
  }
  assert.deepEqual([...coveredEngines].sort(), ['DAST', 'IAST', 'SAST', 'SCA'])
  assert.doesNotMatch(JSON.stringify(demo), /moduleId|ruleId|payload|matcher|policyId|expectedFinding|findingCount/i)
})

test('scanner target catalogue is a minimal, exact projection of public missions', () => {
  const projected = missions.missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    summary: mission.summary,
    category: mission.category,
    engines: mission.engines,
    route: mission.route,
    targets: Object.entries(mission.targets).map(([variant, target]) => ({
      variant,
      id: target.id,
      title: target.title,
      route: target.route,
      displayRoute: target.displayRoute,
      visibleBehavior: target.visibleBehavior,
      ...(target.runtime ? { runtime: target.runtime } : {}),
      ...(target.request ? { request: target.request } : {}),
      ...(target.journey ? { journey: target.journey } : {}),
      ...(target.action ? { action: target.action } : {}),
      ...(mission.dependency ? {
        dependency: {
          name: mission.dependency.name,
          version: variant === 'review' ? mission.dependency.reviewVersion : mission.dependency.repairedVersion
        }
      } : {})
    }))
  }))

  assert.equal(scannerTargets.schema, 'owasp-browser-security-targets/v1')
  assert.equal(scannerTargets.version, 1)
  assert.deepEqual(scannerTargets.missions, projected)
  const serialized = JSON.stringify(scannerTargets)
  assert.doesNotMatch(serialized, /completion|objectives|answer|payload|matcher|ruleId|policyId/)
  assert.equal(scannerTargets.missions.reduce((total, mission) => total + mission.targets.length, 0), missions.missions.length * 2)
})

test('public mission catalogue is local and has paired target contracts', () => {
  assert.equal(missions.schema, 'owasp-browser-security-missions/v1')
  assert.equal(missions.version, 1)
  assert.ok(Array.isArray(missions.missions) && missions.missions.length > 0)
  const ids = new Set()
  const targetIds = new Set()
  const routeServer = read('passive/server.mjs')
  for (const mission of missions.missions) {
    assert.ok(mission.id && !ids.has(mission.id), `duplicate or missing mission id: ${mission.id}`)
    ids.add(mission.id)
    assert.deepEqual(mission.modes, ['campaign', 'explorer', 'demo', 'scanner'])
    assert.deepEqual(mission.objectives.map((objective) => objective.id), ['discover', 'prove', 'fix'])
    assert.ok(mission.route.startsWith('./') && !mission.route.startsWith('//'))
    for (const target of Object.values(mission.targets || {})) {
      assert.ok(target.id && !targetIds.has(target.id), `duplicate or missing mission target id: ${target.id}`)
      targetIds.add(target.id)
      assert.ok(target.route.startsWith('./') && !target.route.startsWith('//'))
      if (target.runtime?.kind === 'route-aware-server') {
        const pathname = new URL(target.route.replace(/^\.\//, '/'), 'http://playground.test').pathname
        if (pathname.startsWith('/targets/xss/reflected/')) {
          assert.match(routeServer, /serveReflectedXss\(req, res, url\)/)
          assert.match(read('passive/real-labs.mjs'), /targets\\\/xss\\\/reflected/)
        } else if (pathname.startsWith('/targets/xss/reflected-attribute/')) {
          assert.match(routeServer, /serveAttributeXss\(req, res, url\)/)
          assert.match(read('passive/real-labs.mjs'), /targets\\\/xss\\\/reflected-attribute/)
        } else {
          assert.ok(routeServer.includes(`"${pathname}"`), `route server is missing mission target: ${pathname}`)
        }
      } else {
        const relative = target.route.replace(/^\.\//, '')
        assert.ok(fs.existsSync(path.join(repoRoot, relative)), `missing mission target: ${relative}`)
      }
      if (target.source) {
        assert.ok(target.source.startsWith('./') && !target.source.startsWith('//'))
        const relativeSource = target.source.replace(/^\.\//, '')
        assert.ok(fs.existsSync(path.join(repoRoot, relativeSource)), `missing mission source: ${relativeSource}`)
      }
      if (target.action) {
        assert.match(target.action.triggerSelector, /^#[A-Za-z][\w-]*$/)
        assert.match(target.action.readySelector, /^#[A-Za-z][\w-]*$/)
        assert.ok(target.action.summary)
      }
    }
  }
})

test('product preview metadata is exact, presentation-only and scanner-neutral', () => {
  const allowedFields = ['availability', 'engines', 'label', 'status', 'summary']
  const allowedEngines = new Set(['DAST', 'SAST', 'IAST'])
  const allowedStatuses = new Set(['validated', 'in-progress'])
  const previews = missions.missions
    .filter((mission) => mission.productPreview)
    .map((mission) => ({ id: mission.id, preview: mission.productPreview }))

  assert.deepEqual(previews.map(({ id }) => id), [
    'session-bound-order-search',
    'saved-workspace',
    'imported-request-preferences'
  ])
  assert.deepEqual(
    previews.map(({ id, preview }) => [id, preview.status, preview.engines]),
    [
      ['session-bound-order-search', 'in-progress', ['DAST']],
      ['saved-workspace', 'validated', ['SAST']],
      ['imported-request-preferences', 'validated', ['SAST']]
    ]
  )

  for (const { id, preview } of previews) {
    assert.deepEqual(Object.keys(preview).sort(), allowedFields, `${id} preview fields must be exact`)
    assert.equal(preview.label, 'PTK Pro')
    assert.equal(preview.availability, 'coming-soon')
    assert.ok(allowedStatuses.has(preview.status), `${id} has an invalid preview status`)
    assert.ok(preview.engines.length > 0, `${id} must name at least one planned engine`)
    assert.equal(new Set(preview.engines).size, preview.engines.length, `${id} repeats a planned engine`)
    assert.ok(preview.engines.every((engine) => allowedEngines.has(engine)), `${id} names a forbidden preview engine`)
    assert.ok(preview.summary.length >= 20 && preview.summary.length <= 180, `${id} preview summary is not bounded`)
    assert.doesNotMatch(
      preview.summary,
      /https?:|portal|rule\s*id|module\s*id|payload|detector|matcher|policy|entitlement|credential|expected\s+finding/i,
      `${id} preview exposes implementation detail`
    )
  }

  assert.doesNotMatch(JSON.stringify(scannerTargets), /PTK Pro|coming-soon|productPreview|portal/i)
  assert.doesNotMatch(JSON.stringify(demo), /PTK Pro|coming-soon|productPreview|portal/i)
  for (const file of walk(path.join(repoRoot, 'targets'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /PTK Pro|coming-soon|productPreview|portal/i, `${path.relative(repoRoot, file)} contains product preview metadata`)
  }
})

test('public product preview terminology is confined to the approved presentation layer', () => {
  const publicFiles = [
    'README.md',
    'index.html',
    'sast/index.html',
    'iast/index.html',
    'passive/index.html',
    'catalog/cases.json',
    'catalog/missions.json',
    'catalog/scanner-targets.json',
    'catalog/demo.json',
    'catalog/challenges.json',
    'catalog/families.json',
    'catalog/playlists.json',
    'catalog/source-ledger.json',
    'catalog/legacy-routes.json',
    'campaigns/index.html',
    'demo/index.html',
    'scanner/index.html',
    'play/index.html',
    'explore/index.html',
    ...missions.missions.map((mission) => `${mission.route.replace(/^\.\//, '')}index.html`),
    'assets/js/playground.js',
    'assets/js/catalogue-app.js',
    'assets/css/playground.css'
  ]
  const previewPresentationFiles = new Set([
    'README.md',
    'campaigns/index.html',
    'jwt/index.html',
    'labs/xss/index.html',
    'catalog/missions.json',
    'catalog/challenges.json',
    'assets/js/playground.js',
    'assets/js/catalogue-app.js'
  ])
  for (const file of publicFiles) {
    if (file !== 'assets/js/playground.js') {
      assert.doesNotMatch(read(file), /portal/i, `${file} exposes Portal terminology`)
    }
    if (!previewPresentationFiles.has(file)) {
      assert.doesNotMatch(read(file), /\bpro\b/i, `${file} exposes product-preview terminology outside the approved layer`)
    }
    assert.doesNotMatch(read(file), /"category"\s*:\s*"(?:free|full|base \+ full|free \+ full)"/i, `${file} exposes an internal edition as a category`)
  }

  for (const file of walk(repoRoot).filter((entry) => entry.endsWith('.html'))) {
    const relative = path.relative(repoRoot, file)
    const visibleMarkup = fs.readFileSync(file, 'utf8')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    assert.doesNotMatch(visibleMarkup, /\bportal\b/i, `${relative} exposes Portal terminology in visible text`)
    if (!['campaigns/index.html', 'jwt/index.html', 'labs/xss/index.html'].includes(relative)) {
      assert.doesNotMatch(visibleMarkup, /\bpro\b/i, `${relative} exposes product-preview terminology in visible text`)
    }
  }
  assert.equal(
    read('assets/js/playground.js').match(/\bportal\b/gi)?.length,
    1,
    'the renderer may name Portal only once inside the preview-summary rejection pattern'
  )
})

test('catalogue routes resolve to static fixtures or passive server routes', () => {
  const passiveServer = read('passive/server.mjs')
  for (const entry of catalog.cases) {
    if (entry.engine === 'dast-passive') {
      const pathname = new URL(entry.route, 'http://playground.test').pathname
      assert.ok(passiveServer.includes(`"${pathname}"`), `passive route is not served: ${entry.id} ${pathname}`)
      continue
    }
    const relative = entry.route.replace(/^\.\//, '')
    assert.ok(fs.existsSync(path.join(repoRoot, relative)), `missing static case: ${entry.id} ${relative}`)
  }
})

test('public index pages use the shared self-hosted shell', () => {
  const pages = [
    'index.html',
    'sast/index.html',
    'iast/index.html',
    'passive/index.html',
    'campaigns/index.html',
    'demo/index.html',
    'scanner/index.html',
    ...missions.missions.map((mission) => `${mission.route.replace(/^\.\//, '')}index.html`)
  ]
  for (const page of pages) {
    const html = read(page)
    assert.match(html, /assets\/css\/playground\.css/)
    assert.match(html, /assets\/js\/playground\.js/)
    assert.match(html, /<main\b/)
    assert.match(html, /authorised/i)
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, `${page} must not execute remote scripts`)
    assert.doesNotMatch(html, /<link[^>]+href=["']https?:\/\//i, `${page} must not load remote styles`)
  }
  assert.doesNotMatch(read('assets/js/playground.js'), /\.innerHTML\s*=/, 'catalogue renderer must not reinterpret text as HTML')
  assert.doesNotMatch(read('assets/js/catalogue-app.js'), /\.innerHTML\s*=/, 'canonical renderer must not reinterpret text as HTML')
  assert.match(read('demo/index.html'), /data-page="demo"/)
  assert.match(read('index.html'), /href="\.\/play\/"/)
  assert.match(read('index.html'), /href="\.\/explore\/"/)
  for (const mission of missions.missions) {
    assert.match(read(`${mission.route.replace(/^\.\//, '')}index.html`), /href="\.\.\/\.\.\/(?:play|labs|jwt)\//)
  }
})

test('home page stays focused while compatibility and preview surfaces remain available elsewhere', () => {
  const home = read('index.html')
  assert.doesNotMatch(home, /Conference-ready path|Show the browser as the source of truth|Open legacy presenter view/)
  assert.doesNotMatch(home, /PTK Pro|product-preview|data-product-preview-list/)
  assert.doesNotMatch(home, /href="\.\/campaigns\/"|href="\.\/scanner\/"/)
  assert.match(home, /href="\.\/play\/"/)
  assert.match(home, /href="\.\/explore\/"/)
  assert.ok(fs.existsSync(path.join(repoRoot, 'campaigns/index.html')))
  assert.ok(fs.existsSync(path.join(repoRoot, 'scanner/index.html')))
})

test('Play and Explore render from canonical catalogues rather than handwritten case cards', () => {
  const play = read('play/index.html')
  const explore = read('explore/index.html')
  const renderer = read('assets/js/catalogue-app.js')

  for (const [name, page] of [['Play', play], ['Explore', explore]]) {
    assert.match(page, /assets\/js\/catalogue-app\.js/, `${name} does not load the canonical renderer`)
    assert.doesNotMatch(page, /data-challenge-id=/, `${name} hardcodes canonical challenge cards`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes remote code`)
    assert.doesNotMatch(page, /Legacy missions|Compatibility target view/, `${name} promotes a compatibility directory`)
    assert.match(page, /https:\/\/github\.com\/ptklabs\/ptk-playground#run-the-complete-local-demo-with-docker/)
  }
  assert.match(renderer, /text: 'Run locally for DAST'/)
  assert.match(renderer, /https:\/\/github\.com\/ptklabs\/ptk-playground#run-the-complete-local-demo-with-docker/)
  assert.match(play, /data-playlist-list/)
  assert.match(play, /data-playlist-challenges/)
  assert.match(explore, /data-explore-results/)
  assert.match(explore, /data-explore-engine/)
  assert.match(renderer, /catalog\/challenges\.json/)
  assert.match(renderer, /catalog\/families\.json/)
  assert.match(renderer, /catalog\/playlists\.json/)
  assert.match(renderer, /Start guided mission/)
  assert.match(renderer, /derivedChallengeIds/)
  assert.match(renderer, /if \(!runtime\) return null/)
  assert.doesNotMatch(renderer, /PTK_AGENT|chrome\.runtime|browser\.runtime/)
})

test('fixture markup has no duplicate static element IDs', () => {
  const htmlFiles = walk(repoRoot).filter((file) => file.endsWith('.html'))
  const duplicates = []
  for (const file of htmlFiles) {
    const markup = fs.readFileSync(file, 'utf8')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<pre\b[\s\S]*?<\/pre>/gi, '')
    const ids = [...markup.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1])
    const seen = new Set()
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(`${path.relative(repoRoot, file)}#${id}`)
      seen.add(id)
    }
  }
  assert.deepEqual(duplicates, [])
})

test('known legacy remote fixture dependencies are bounded and cannot grow silently', () => {
  const known = new Set([
    'sast/ajax_request_header.advanced.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/client_template_injection.advanced.html|https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.13.6/underscore-min.js',
    'sast/dom_selector.advanced.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/javascript_injection_taint.advanced.html|https://code.jquery.com/jquery-3.7.1.min.js',
    'sast/link_manipulation.advanced.html|https://code.jquery.com/jquery-3.7.1.min.js'
  ])
  const actual = new Set()
  for (const file of walk(repoRoot).filter((entry) => entry.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8')
    for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)) {
      actual.add(`${path.relative(repoRoot, file)}|${match[1]}`)
    }
  }
  assert.deepEqual([...actual].sort(), [...known].sort())
})

test('the local AngularJS canary dependency is pinned with its upstream license', () => {
  const source = readJson('assets/vendor/angularjs/SOURCE.json')
  assert.equal(source.package, 'angular')
  assert.equal(source.version, '1.8.3')
  assert.equal(source.license, 'MIT')
  for (const [file, expectedHash] of Object.entries(source.files || {})) {
    assert.equal(sha256(`assets/vendor/angularjs/${file}`), expectedHash, `${file} does not match its recorded upstream hash`)
  }
  assert.match(read('assets/vendor/angularjs/LICENSE.md'), /MIT License/i)
})

test('the support-widget dependency pair is pinned locally with source hashes and licence', () => {
  const source = readJson('assets/vendor/jquery/SOURCE.json')
  assert.equal(source.package, 'jquery')
  assert.equal(source.license, 'MIT')
  assert.equal(source.files['jquery-3.4.1.min.js'].version, '3.4.1')
  assert.equal(source.files['jquery-3.7.1.min.js'].version, '3.7.1')
  for (const [file, metadata] of Object.entries(source.files || {})) {
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/)
    assert.equal(sha256(`assets/vendor/jquery/${file}`), metadata.sha256, `${file} does not match its recorded upstream hash`)
  }
  assert.match(read('assets/vendor/jquery/LICENSE.txt'), /permission is hereby granted/i)
})

test('support-widget campaign state and target evidence remain isolated', () => {
  const shell = read('campaigns/support-widget/index.html')
  const sharedScript = read('assets/js/playground.js')
  const vulnerablePage = read('targets/support-widget/vulnerable/index.html')
  const fixedPage = read('targets/support-widget/fixed/index.html')
  const vulnerableScript = read('targets/support-widget/vulnerable/widget.js')
  const fixedScript = read('targets/support-widget/fixed/widget.js')

  assert.match(shell, /assets\/js\/playground\.js/)
  assert.doesNotMatch(shell, /jquery-3\.(?:4\.1|7\.1)|targets\/support-widget\/(?:vulnerable|fixed)\/widget\.js/)
  assert.match(sharedScript, /owasp-browser-security-campaign\/v1:/)

  for (const [name, page] of [['vulnerable', vulnerablePage], ['fixed', fixedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} target imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} target executes a remote script`)
  }
  for (const [name, source] of [['vulnerable', vulnerableScript], ['fixed', fixedScript]]) {
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT/i, `${name} script reads campaign or extension state`)
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i, `${name} script performs a network request`)
  }

  assert.match(vulnerablePage, /jquery-3\.4\.1\.min\.js/)
  assert.match(fixedPage, /jquery-3\.7\.1\.min\.js/)
  assert.match(vulnerableScript, /\.html\(message\.html\)/)
  assert.doesNotMatch(vulnerableScript, /event\.origin\s*[!=]==?/)
  assert.match(fixedScript, /event\.origin\s*!==\s*SUPPORT_ORIGIN/)
  assert.match(fixedScript, /typeof event\.data !== "string"/)
  assert.match(fixedScript, /const message = \{ type: "support:reply", text: event\.data \}/)
  assert.match(fixedScript, /\.textContent\s*=\s*message\.text/)
  assert.doesNotMatch(fixedScript, /\.html\s*\(|\.innerHTML\s*=/)
})

test('deployment response mission keeps gameplay out of its route-aware target', () => {
  const shell = read('campaigns/deployment-response-boundary/index.html')
  const targetPage = read('passive/header_disclosure_canary.html')
  const targetScript = read('passive/header_disclosure_canary.js')

  assert.match(shell, /data-mission-id="deployment-response-boundary"/)
  assert.doesNotMatch(targetPage, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetScript, /sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetPage, /<script[^>]+src=["']https?:\/\//i)
  assert.match(targetScript, /response\.headers\.has\('x-powered-by'\)/)
  assert.match(targetScript, /RESPONSE-METADATA-DISCLOSED/)
  assert.match(targetScript, /RESPONSE-METADATA-CLEAN/)
})

test('session-bound order-search mission keeps active DAST traffic isolated and bounded', () => {
  const publicMission = missions.missions.find((entry) => entry.id === 'session-bound-order-search')
  const shell = read('campaigns/session-bound-order-search/index.html')
  const targetPage = read('targets/session-bound-order-search/index.html')
  const targetScript = read('targets/session-bound-order-search/order-search.js')
  const routeServer = read('passive/server.mjs')
  const orderSearchHandler = routeServer.slice(
    routeServer.indexOf('async function serveOrderSearchApi'),
    routeServer.indexOf('function handleUpgrade')
  )

  assert.match(shell, /data-mission-id="session-bound-order-search"/)
  assert.doesNotMatch(targetPage, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetScript, /sessionStorage|localStorage|PTK_AGENT/i)
  assert.doesNotMatch(targetPage, /<script[^>]+src=["']https?:\/\//i)
  assert.match(targetScript, /new URL\('\.\/api\/search', window\.location\.href\)/)
  assert.match(targetScript, /credentials:\s*'same-origin'/)
  assert.match(targetScript, /result\.textContent\s*=/)
  assert.doesNotMatch(targetScript, /\.innerHTML\s*=/)

  assert.match(orderSearchHandler, /if \(!isHttps\)/)
  assert.match(orderSearchHandler, /req\.method !== "POST"/)
  assert.match(orderSearchHandler, /ptk_order_session=active/)
  assert.match(orderSearchHandler, /x-playground-request/)
  assert.match(orderSearchHandler, /readBoundedBody\(req\)/)
  assert.match(orderSearchHandler, /query\.length > 256/)
  assert.match(orderSearchHandler, /message:\s*"You have an error in your SQL syntax near the order search value"/)
  assert.doesNotMatch(orderSearchHandler, /message:\s*query\s*[,}]|JSON\.stringify\([^\n]*query/)

  for (const target of Object.values(publicMission.targets)) {
    assert.deepEqual(Object.keys(target.request).sort(), ['contentType', 'method', 'parameterNames', 'route', 'setup'])
    assert.deepEqual(target.request.parameterNames, ['query'])
    assert.ok(!Object.hasOwn(target.request, 'payload'))
    assert.ok(!Object.hasOwn(target.request, 'headers'))
  }
})

test('on-demand analytics mission loads only its pinned same-origin dependency after action', () => {
  const mission = missions.missions.find((entry) => entry.id === 'on-demand-analytics')
  const reviewPage = read('targets/on-demand-analytics/vulnerable/index.html')
  const repairedPage = read('targets/on-demand-analytics/fixed/index.html')
  const loader = read('targets/on-demand-analytics/analytics-loader.js')

  assert.match(read('campaigns/on-demand-analytics/index.html'), /data-mission-id="on-demand-analytics"/)
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.match(page, /\.\.\/analytics-loader\.js/)
    assert.doesNotMatch(page, /jquery-3\.(?:4\.1|7\.1)\.min\.js/, `${name} page eagerly loads the dependency`)
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i)
  }
  assert.match(loader, /loadButton\?\.addEventListener\('click'/)
  assert.match(loader, /jquery-3\.4\.1\.min\.js/)
  assert.match(loader, /jquery-3\.7\.1\.min\.js/)
  assert.match(loader, /new URL\(dependencyPath, import\.meta\.url\)/)
  assert.match(loader, /document\.head\.append\(dependency\)/)
  assert.match(loader, /window\.jQuery\(summary\)\.text\(/)
  assert.doesNotMatch(loader, /\.innerHTML\s*=|sessionStorage|localStorage|PTK_AGENT|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i)
  assert.equal(mission.dependency.reviewVersion, '3.4.1')
  assert.equal(mission.dependency.repairedVersion, '3.7.1')
})

test('saved-workspace mission preserves a two-document storage journey and strict repaired sink', () => {
  const mission = missions.missions.find((entry) => entry.id === 'saved-workspace')
  const editor = read('targets/saved-workspace/workspace-editor.js')
  const reviewPage = read('targets/saved-workspace/vulnerable/index.html')
  const reviewDashboard = read('targets/saved-workspace/vulnerable/dashboard.html')
  const reviewSource = read('targets/saved-workspace/vulnerable/dashboard.js')
  const repairedPage = read('targets/saved-workspace/fixed/index.html')
  const repairedDashboard = read('targets/saved-workspace/fixed/dashboard.html')
  const repairedSource = read('targets/saved-workspace/fixed/dashboard.js')

  assert.ok(mission)
  assert.match(read('campaigns/saved-workspace/index.html'), /data-mission-id="saved-workspace"/)
  assert.match(editor, /localStorage\.setItem\(storageKey, announcement\.value\)/)
  assert.match(editor, /window\.location\.assign\(new URL\('\.\/dashboard\.html'/)
  assert.doesNotMatch(editor, /innerHTML|outerHTML|document\.write/)

  for (const [name, page] of [
    ['review setup', reviewPage],
    ['review dashboard', reviewDashboard],
    ['repaired setup', repairedPage],
    ['repaired dashboard', repairedDashboard]
  ]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  assert.match(reviewSource, /localStorage\.getItem\(STORAGE_KEY\)/)
  assert.match(reviewSource, /preview\.innerHTML\s*=\s*savedAnnouncement/)
  assert.match(repairedSource, /localStorage\.getItem\(STORAGE_KEY\)/)
  assert.match(repairedSource, /preview\.textContent\s*=\s*savedAnnouncement/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write/)
  assert.doesNotMatch(`${editor}\n${reviewSource}\n${repairedSource}`, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|PTK_AGENT/i)
  assert.notEqual(
    reviewPage.match(/data-storage-key="([^"]+)"/)?.[1],
    repairedPage.match(/data-storage-key="([^"]+)"/)?.[1]
  )

  for (const target of Object.values(mission.targets)) {
    assert.ok(target.journey)
    assert.equal(target.journey.entrySelector, '#save-announcement')
    assert.equal(target.journey.childReadySelector, '#announcement-status')
    assert.ok(target.journey.childRoute.startsWith('/targets/saved-workspace/'))
    assert.ok(fs.existsSync(path.join(repoRoot, target.journey.childRoute.slice(1))))
  }
})

test('live-profile-preview mission preserves one action-loaded response and a strict text control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'live-profile-preview')
  const response = read('targets/live-profile-preview/profile.json')
  const reviewPage = read('targets/live-profile-preview/vulnerable/index.html')
  const reviewSource = read('targets/live-profile-preview/vulnerable/profile-preview.js')
  const repairedPage = read('targets/live-profile-preview/fixed/index.html')
  const repairedSource = read('targets/live-profile-preview/fixed/profile-preview.js')

  assert.ok(mission)
  assert.match(read('campaigns/live-profile-preview/index.html'), /data-mission-id="live-profile-preview"/)
  assert.deepEqual(JSON.parse(response), {
    displayName: 'Avery Morgan',
    summaryHtml: '<mark data-profile-proof="true">Priority customer profile</mark>',
    lastUpdated: '2026-08-13'
  })
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /fetch\('\.\.\/profile\.json'/, `${name} does not request the shared profile response`)
    assert.match(source, /credentials:\s*'omit'/)
    assert.match(source, /setTimeout\(resolve, 250\)/, `${name} does not preserve the deferred UI-render boundary`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /preview\.innerHTML\s*=\s*profile\.summaryHtml/)
  assert.match(repairedSource, /preview\.textContent\s*=\s*profile\.summaryHtml/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write|insertAdjacentHTML/)
  for (const target of Object.values(mission.targets)) {
    assert.deepEqual(Object.keys(target.action).sort(), ['readySelector', 'summary', 'triggerSelector'])
    assert.equal(target.action.triggerSelector, '#load-profile')
    assert.equal(target.action.readySelector, '#profile-status')
  }
})

test('transient-route-notice mission preserves one short SPA route action and a non-reflecting control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'transient-route-notice')
  const reviewPage = read('targets/transient-route-notice/vulnerable/index.html')
  const reviewSource = read('targets/transient-route-notice/vulnerable/route-notice.js')
  const repairedPage = read('targets/transient-route-notice/fixed/index.html')
  const repairedSource = read('targets/transient-route-notice/fixed/route-notice.js')

  assert.ok(mission)
  assert.deepEqual(mission.engines, ['DAST', 'SAST', 'IAST'])
  assert.match(read('campaigns/transient-route-notice/index.html'), /data-mission-id="transient-route-notice"/)
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /window\.location\.hash\.split\('\?'\)/, `${name} does not read the hash-query route`)
    assert.match(source, /window\.location\.hash\s*=\s*`#\/incidents\?notice=/, `${name} does not preserve the route action`)
    assert.match(source, /}, 30\)/, `${name} does not preserve the 30 ms expiry boundary`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /notice\.innerHTML\s*=\s*routeNotice/)
  assert.match(repairedSource, /notice\.textContent\s*=\s*acceptedNotices\.get\(routeNotice\)\s*\|\|/)
  assert.match(repairedSource, /acceptedNotices\.has\(routeNotice\)/)
  assert.doesNotMatch(repairedSource, /innerHTML|outerHTML|document\.write|insertAdjacentHTML/)
  for (const target of Object.values(mission.targets)) {
    assert.equal(target.action.triggerSelector, '#open-route-notice')
    assert.equal(target.action.readySelector, '#route-status')
  }
})

test('imported-request-preferences mission preserves one local request and rejects inherited options in its control', () => {
  const mission = missions.missions.find((entry) => entry.id === 'imported-request-preferences')
  const response = read('targets/imported-request-preferences/preview.json')
  const reviewPage = read('targets/imported-request-preferences/vulnerable/index.html')
  const reviewSource = read('targets/imported-request-preferences/vulnerable/request-preferences.js')
  const repairedPage = read('targets/imported-request-preferences/fixed/index.html')
  const repairedSource = read('targets/imported-request-preferences/fixed/request-preferences.js')

  assert.ok(mission)
  assert.deepEqual(mission.engines, ['SAST', 'IAST'])
  assert.match(read('campaigns/imported-request-preferences/index.html'), /data-mission-id="imported-request-preferences"/)
  assert.deepEqual(JSON.parse(response), {
    message: 'Account preview loaded from the same-origin fixture.'
  })
  for (const [name, page] of [['review', reviewPage], ['repaired', repairedPage]]) {
    assert.match(page, /\{"__proto__":\{"credentials":"include"\}\}/, `${name} does not preserve the prepared input`)
    assert.doesNotMatch(page, /assets\/js\/playground\.js|sessionStorage|localStorage|PTK_AGENT/i, `${name} imports campaign or extension state`)
    assert.doesNotMatch(page, /<script[^>]+src=["']https?:\/\//i, `${name} executes a remote script`)
  }
  for (const [name, source] of [['review', reviewSource], ['repaired', repairedSource]]) {
    assert.match(source, /JSON\.parse\(input\.value\)/, `${name} does not parse the shared input`)
    assert.match(source, /fetch\('\.\.\/preview\.json', requestOptions\)/, `${name} does not preserve the local request`)
    assert.doesNotMatch(source, /sessionStorage|localStorage|PTK_AGENT|XMLHttpRequest|WebSocket|sendBeacon/i)
  }
  assert.match(reviewSource, /Object\.assign\(\{\}, imported\)/)
  assert.match(reviewSource, /!hasOwnCredentials && requestOptions\.credentials === 'include'/)
  assert.doesNotMatch(reviewSource, /Object\.prototype\.(?:credentials|mode|headers)\s*=/)
  assert.match(repairedSource, /Object\.create\(null\)/)
  assert.match(repairedSource, /hasOwnProperty\.call\(imported, 'credentials'\)/)
  assert.match(repairedSource, /imported\.credentials === 'omit'/)
  assert.doesNotMatch(repairedSource, /Object\.assign|setPrototypeOf|Reflect\.set|\.__proto__\s*=|Object\.prototype\.[A-Za-z_$][\w$]*\s*=/)
  for (const target of Object.values(mission.targets)) {
    assert.equal(target.action.triggerSelector, '#import-preferences')
    assert.equal(target.action.readySelector, '#preferences-status')
  }
})

test('SPA deep-dive missions preserve browser journeys and exact paired controls', () => {
  const missionById = new Map(missions.missions.map((mission) => [mission.id, mission]))
  const spaPlaylist = canonicalPlaylists.playlists.find((playlist) => playlist.id === 'spa-deep-dive')
  assert.deepEqual(spaPlaylist.challengeIds, [
    'history-order-router',
    'lazy-route-module',
    'same-origin-child-tab'
  ])

  const historyMission = missionById.get('history-order-router')
  assert.deepEqual(historyMission.engines, ['DAST', 'SAST', 'IAST'])
  assert.equal(historyMission.targets.review.request.contentType, 'application/json')
  const historyReview = read('targets/history-order-router/vulnerable/history-order-router.js')
  const historyControl = read('targets/history-order-router/fixed/history-order-router.js')
  assert.match(historyReview, /history\.pushState/)
  assert.match(historyReview, /view\.innerHTML\s*=/)
  assert.match(historyControl, /history\.pushState/)
  assert.match(historyControl, /view\.textContent\s*=/)
  assert.doesNotMatch(historyControl, /\.innerHTML\s*=/)

  const lazyMission = missionById.get('lazy-route-module')
  assert.deepEqual(lazyMission.engines, ['SCA', 'SAST', 'IAST'])
  const lazyShell = read('targets/lazy-route-module/vulnerable/lazy-route-app.js')
  const lazyReview = read('targets/lazy-route-module/vulnerable/analytics-route.js')
  const lazyControl = read('targets/lazy-route-module/fixed/analytics-route.js')
  assert.match(lazyShell, /import\('\.\/analytics-route\.js'\)/)
  assert.match(lazyReview, /jquery-3\.4\.1\.min\.js/)
  assert.match(lazyReview, /workspace\.innerHTML\s*=/)
  assert.match(lazyControl, /jquery-3\.7\.1\.min\.js/)
  assert.match(lazyControl, /workspace\.textContent\s*=/)
  assert.doesNotMatch(lazyControl, /\.innerHTML\s*=/)

  const childMission = missionById.get('same-origin-child-tab')
  assert.deepEqual(childMission.engines, ['DAST', 'SCA', 'SAST', 'IAST'])
  const childReview = read('targets/same-origin-child-tab/vulnerable/child-runtime.js')
  const childControl = read('targets/same-origin-child-tab/fixed/child-runtime.js')
  const externalControl = read('targets/same-origin-child-tab/control/index.html')
  assert.match(childReview, /jquery-3\.4\.1\.min\.js/)
  assert.match(childReview, /output\.innerHTML\s*=/)
  assert.doesNotMatch(childReview, /event\.origin\s*!==/)
  assert.match(childControl, /jquery-3\.7\.1\.min\.js/)
  assert.match(childControl, /event\.origin\s*!==\s*window\.location\.origin/)
  assert.match(childControl, /event\.source\s*!==\s*window\.opener/)
  assert.match(childControl, /output\.textContent\s*=/)
  assert.doesNotMatch(childControl, /\.innerHTML\s*=/)
  assert.doesNotMatch(externalControl, /<script\b/i)
  assert.match(externalControl, /receives no message, session value, dependency, or application request/i)

  const historyContract = dastContracts.contracts.find((contract) => contract.route === '/targets/history-order-router/vulnerable/api/order')
  const childContract = dastContracts.contracts.find((contract) => contract.route === '/targets/same-origin-child-tab/vulnerable/api/context')
  assert.deepEqual(historyContract.methods, ['POST'])
  assert.equal(historyContract.runtime.protocol, 'http')
  assert.equal(historyContract.controlRoute, '/targets/history-order-router/fixed/api/order')
  assert.deepEqual(childContract.methods, ['GET'])
  assert.equal(childContract.controlRoute, '/targets/same-origin-child-tab/fixed/api/context')
  const runtime = read('passive/server.mjs')
  assert.match(runtime, /ptk_history_order_session=active/)
  assert.match(runtime, /ptk_child_context_session=active/)
  assert.match(runtime, /readBoundedBody\(req, 2048\)/)
  assert.match(runtime, /X-Powered-By": "PTK Child Context Canary"/)
})

test('catalogue renderer does not expose passive localhost links in catalogue mode', () => {
  const source = read('assets/js/playground.js')
  assert.match(source, /if \(!passiveStatus\) return null/)
  assert.match(source, /Start local server/)
  assert.doesNotMatch(read('passive/index.html'), /href=["']https?:\/\/localhost:/i)
})

test('route-aware passive server serves the shared playground shell and catalogue', () => {
  const source = read('passive/server.mjs')
  for (const route of [
    '/assets/css/playground.css',
    '/assets/js/playground.js',
    '/assets/js/catalogue-app.js',
    '/catalog/cases.json',
    '/catalog/missions.json',
    '/catalog/scanner-targets.json',
    '/catalog/demo.json',
    '/catalog/challenges.json',
    '/catalog/families.json',
    '/catalog/playlists.json',
    '/catalog/source-ledger.json',
    '/catalog/legacy-routes.json',
    '/play/',
    '/explore/',
    '/demo/',
    '/scanner/',
    '/campaigns/deployment-response-boundary/',
    '/campaigns/session-bound-order-search/',
    '/campaigns/on-demand-analytics/',
    '/campaigns/saved-workspace/',
    '/campaigns/live-profile-preview/',
    '/campaigns/transient-route-notice/',
    '/campaigns/imported-request-preferences/',
    '/targets/support-widget/vulnerable/',
    '/targets/support-widget/fixed/',
    '/targets/on-demand-analytics/vulnerable/',
    '/targets/on-demand-analytics/fixed/',
    '/targets/saved-workspace/vulnerable/',
    '/targets/saved-workspace/vulnerable/dashboard.html',
    '/targets/saved-workspace/fixed/',
    '/targets/saved-workspace/fixed/dashboard.html',
    '/targets/live-profile-preview/profile.json',
    '/targets/live-profile-preview/vulnerable/',
    '/targets/live-profile-preview/vulnerable/profile-preview.js',
    '/targets/live-profile-preview/fixed/',
    '/targets/live-profile-preview/fixed/profile-preview.js',
    '/targets/transient-route-notice/vulnerable/',
    '/targets/transient-route-notice/vulnerable/route-notice.js',
    '/targets/transient-route-notice/fixed/',
    '/targets/transient-route-notice/fixed/route-notice.js',
    '/targets/imported-request-preferences/preview.json',
    '/targets/imported-request-preferences/vulnerable/',
    '/targets/imported-request-preferences/vulnerable/request-preferences.js',
    '/targets/imported-request-preferences/fixed/',
    '/targets/imported-request-preferences/fixed/request-preferences.js',
    '/targets/session-bound-order-search/vulnerable/',
    '/targets/session-bound-order-search/fixed/',
    '/targets/session-bound-order-search/order-search.js',
    '/passive/assets/header-disclosure-canary.js'
  ]) {
    assert.ok(source.includes(`"${route}"`), `passive server is missing ${route}`)
  }
})

test('local demo container preserves the bounded route-aware security contract', () => {
  const dockerfile = read('Dockerfile')
  const compose = read('compose.yaml')
  const dockerignore = read('.dockerignore')
  const workflow = read('.github/workflows/validate.yml')
  const smoke = read('scripts/container-smoke.mjs')
  const preflight = read('scripts/demo-preflight.mjs')
  const packageJson = readJson('package.json')

  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m)
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends openssl/)
  assert.match(dockerfile, /PTK_PLAYGROUND_HOST=0\.0\.0\.0/)
  assert.match(dockerfile, /^USER node$/m)
  assert.match(dockerfile, /^EXPOSE 3080 3443$/m)
  assert.match(dockerfile, /HEALTHCHECK[^\n]*\\\n\s*CMD \["node"/)
  assert.match(dockerfile, /^RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund$/m)
  assert.doesNotMatch(dockerfile, /npm install|playwright/i)
  assert.deepEqual(packageJson.dependencies, { 'sql.js': '1.14.2' })

  assert.match(compose, /read_only:\s*true/)
  assert.match(compose, /127\.0\.0\.1:3080:3080/)
  assert.match(compose, /127\.0\.0\.1:3443:3443/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/)
  assert.match(compose, /\/tmp:size=16m,mode=1777/)

  for (const excluded of ['.git', '.github', 'node_modules', 'test', 'scripts', '.env', '**/.DS_Store', '**/._*', '**/__MACOSX']) {
    assert.ok(dockerignore.split('\n').includes(excluded), `.dockerignore must exclude ${excluded}`)
  }

  assert.equal(packageJson.scripts['demo:container:smoke'], 'node scripts/container-smoke.mjs')
  assert.match(smoke, /https:\/\/127\.0\.0\.1:3443/)
  assert.match(smoke, /spa-deep-dive/)
  assert.match(smoke, /ORDER_QUERY_SYNTAX/)
  assert.match(preflight, /play\/\?playlist=browser-context-demo/)
  assert.match(workflow, /docker build --tag ptk-playground:ci/)
  assert.match(workflow, /--publish 127\.0\.0\.1:3080:3080/)
  assert.match(workflow, /npm run demo:container:smoke/)
})
