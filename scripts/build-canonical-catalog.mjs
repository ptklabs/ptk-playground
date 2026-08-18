import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other'
}

function normalizeEngine(engine) {
  if (engine === 'dast-passive') return 'DAST'
  return String(engine).toUpperCase()
}

function localTarget(target) {
  const result = {
    id: target.id,
    title: target.title,
    route: target.route,
    visibleBehavior: target.visibleBehavior
  }
  for (const field of ['runtime', 'action', 'journey', 'request']) {
    if (target[field] !== undefined) result[field] = target[field]
  }
  return result
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function publish(relativePath, value) {
  const output = serialize(value)
  const absolute = path.join(repoRoot, relativePath)
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== output) {
      throw new Error(`${relativePath} is stale; run npm run catalog:generate`)
    }
    return
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, output)
}

const cases = readJson('catalog/cases.json').cases
const missions = readJson('catalog/missions.json').missions
const demo = readJson('catalog/demo.json')
const sourceLedger = readJson('catalog/source-ledger.json')
const atomicSast = readJson('catalog/sast-atomic.json')
const atomicIast = readJson('catalog/iast-atomic.json')
const dastContracts = readJson('catalog/dast-contracts.json')
const scaDependencies = readJson('catalog/sca-dependencies.json')

const sourceByCatalogId = new Map()
const sourceIdsByRuntimeContract = new Map()
for (const source of sourceLedger.sources) {
  for (const caseId of source.catalogCaseIds || []) sourceByCatalogId.set(caseId, source)
  for (const scenario of source.scenarios || []) {
    for (const contractId of scenario.runtimeContractIds || []) {
      const ids = sourceIdsByRuntimeContract.get(contractId) || []
      ids.push(source.id)
      sourceIdsByRuntimeContract.set(contractId, ids)
    }
  }
}

const consumedCaseIds = new Set()
const challenges = []

for (const mission of missions) {
  const legacyCaseIds = []
  if (mission.id === 'deployment-response-boundary') {
    legacyCaseIds.push('passive.header-disclosure-present', 'passive.header-disclosure-control')
    legacyCaseIds.forEach((id) => consumedCaseIds.add(id))
  }
  const challenge = {
    id: mission.id,
    kind: 'atomic-challenge',
    title: mission.title,
    summary: mission.summary,
    category: mission.category,
    engines: [...mission.engines],
    availability: 'available',
    migrationStatus: 'implemented',
    suitability: {
      manual: true,
      automation: true
    },
    targets: {
      review: localTarget(mission.targets.review),
      repaired: localTarget(mission.targets.repaired)
    },
    provenance: {
      missionId: mission.id,
      legacyCaseIds
    },
    guidance: {
      route: mission.route,
      objectiveCount: mission.objectives.length,
      supportsProgress: true,
      supportsHints: true,
      supportsProofTokens: mission.objectives.some((objective) => objective.completion?.type === 'proof')
    }
  }
  if (mission.dependency) challenge.dependency = mission.dependency
  if (mission.productPreview) challenge.productPreview = mission.productPreview
  challenges.push(challenge)
}

const hashPositive = cases.find((entry) => entry.id === 'sast.hash-html-rendering')
const hashControl = cases.find((entry) => entry.id === 'sast.hash-text-rendering-control')
if (hashPositive && hashControl) {
  consumedCaseIds.add(hashPositive.id)
  consumedCaseIds.add(hashControl.id)
  challenges.push({
    id: 'hash-html-rendering',
    kind: 'atomic-challenge',
    title: 'Hash-driven HTML rendering',
    summary: 'Compare a URL hash rendered as HTML with the same value rendered as text.',
    category: hashPositive.category,
    engines: ['SAST'],
    availability: 'available',
    migrationStatus: 'implemented',
    suitability: {
      manual: true,
      automation: true
    },
    targets: {
      review: {
        id: hashPositive.id,
        title: hashPositive.title,
        route: hashPositive.route,
        visibleBehavior: hashPositive.description
      },
      repaired: {
        id: hashControl.id,
        title: hashControl.title,
        route: hashControl.route,
        visibleBehavior: hashControl.description
      }
    },
    provenance: {
      legacyCaseIds: [hashPositive.id, hashControl.id],
      sourceIds: [sourceByCatalogId.get(hashPositive.id)?.id, sourceByCatalogId.get(hashControl.id)?.id].filter(Boolean)
    }
  })
}

for (const entry of atomicSast.challenges) {
  const source = sourceLedger.sources.find((candidate) => candidate.id === entry.sourceId)
  challenges.push({
    id: entry.id,
    kind: 'atomic-challenge',
    title: entry.title,
    summary: 'A single historical client-code assertion isolated from its broad compatibility lab with a separate repaired source file.',
    category: source?.title || 'Client-side source and sink',
    engines: ['SAST'],
    availability: 'available',
    migrationStatus: 'implemented',
    suitability: {
      manual: true,
      automation: true
    },
    targets: {
      review: {
        id: `${entry.id}.review`,
        title: `${entry.title} review target`,
        route: entry.reviewRoute,
        visibleBehavior: 'The prepared value reaches the one declared review boundary after the focused action.'
      },
      repaired: {
        id: `${entry.id}.repaired`,
        title: `${entry.title} repaired control`,
        route: entry.repairedRoute,
        visibleBehavior: 'The same prepared value and action are preserved while the unsafe boundary is removed.'
      }
    },
    provenance: {
      legacyCaseIds: [],
      sourceIds: [entry.sourceId],
      sourceScenarioIds: [entry.sourceScenarioId],
      compatibilityRoute: entry.sourceRoute
    }
  })
}

for (const entry of atomicIast.challenges) {
  const source = sourceLedger.sources.find((candidate) => candidate.id === entry.sourceId)
  challenges.push({
    id: entry.id,
    kind: 'atomic-challenge',
    title: entry.title,
    summary: 'A single historical browser-runtime assertion isolated with deterministic input, action, visible evidence and a separate repaired control.',
    category: source?.title || 'Browser runtime source and sink',
    engines: ['IAST'],
    availability: 'available',
    migrationStatus: 'implemented',
    suitability: {
      manual: true,
      automation: true
    },
    targets: {
      review: {
        id: `${entry.id}.review`,
        title: `${entry.title} review target`,
        route: entry.reviewRoute,
        visibleBehavior: 'The focused action carries the prepared browser value across one declared runtime boundary.'
      },
      repaired: {
        id: `${entry.id}.repaired`,
        title: `${entry.title} repaired control`,
        route: entry.repairedRoute,
        visibleBehavior: 'The same browser input and action are preserved without crossing the unsafe runtime boundary.'
      }
    },
    provenance: {
      legacyCaseIds: [],
      sourceIds: [entry.sourceId],
      sourceScenarioIds: [entry.sourceScenarioId],
      compatibilityRoute: entry.sourceRoute
    }
  })
}

function dastTitle(contract) {
  return contract.route
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .split('/')
    .map((part) => part.replace(/[-_.]+/g, ' '))
    .filter(Boolean)
    .map((part) => part.replace(/^\w/, (letter) => letter.toUpperCase()))
    .join(' · ') || 'Runtime root'
}

for (const contract of dastContracts.contracts.filter((entry) => entry.role === 'assertion')) {
  const paired = Boolean(contract.controlRoute)
  const sourceIds = [...new Set([
    ...(contract.owners || []).map((owner) => sourceByCatalogId.get(owner)?.id).filter(Boolean),
    ...(sourceIdsByRuntimeContract.get(contract.id) || [])
  ])]
  challenges.push({
    id: contract.id,
    kind: paired ? 'atomic-challenge' : 'atomic-observation',
    title: dastTitle(contract),
    summary: `A route-aware ${contract.evidence.replace(/-/g, ' ')} contract with explicit transport, method and loopback runtime requirements.`,
    category: contract.category,
    engines: ['DAST'],
    availability: 'local-runtime',
    migrationStatus: 'implemented',
    suitability: {
      manual: true,
      automation: true
    },
    targets: {
      review: {
        id: `${contract.id}.review`,
        title: `${dastTitle(contract)} review route`,
        route: contract.route,
        runtime: contract.runtime,
        request: {
          methods: contract.methods,
          transport: contract.transport
        },
        visibleBehavior: `Observe the declared ${contract.evidence.replace(/-/g, ' ')} through the local route-aware runtime.`
      },
      ...(paired ? {
        repaired: {
          id: `${contract.id}.control`,
          title: `${dastTitle(contract)} paired control`,
          route: contract.controlRoute,
          runtime: contract.runtime,
          visibleBehavior: 'The paired route preserves the workflow while removing the declared response or request weakness.'
        }
      } : {})
    },
    provenance: {
      legacyCaseIds: [],
      sourceIds,
      runtimeContractIds: [contract.id]
    }
  })
}

const angularDependency = scaDependencies.scenarios.find((scenario) => scenario.canonicalChallengeId === 'angular-expression-dependency')
if (!angularDependency) throw new Error('AngularJS SCA dependency scenario is missing')
challenges.push({
  id: angularDependency.canonicalChallengeId,
  kind: 'atomic-challenge',
  title: angularDependency.title,
  summary: 'Compare an initially loaded pinned client framework with the same small feature implemented without that dependency.',
  category: 'Initially loaded client dependencies',
  engines: ['SCA'],
  availability: 'available',
  migrationStatus: 'implemented',
  suitability: {
    manual: true,
    automation: true
  },
  dependency: {
    name: angularDependency.package,
    license: angularDependency.license,
    reviewVersion: angularDependency.review.version,
    repairedVersion: angularDependency.repaired.version,
    repairedStrategy: angularDependency.repaired.controlStrategy
  },
  targets: {
    review: {
      id: `${angularDependency.canonicalChallengeId}.review`,
      title: 'Expression workspace review target',
      route: angularDependency.review.targetRoute,
      visibleBehavior: 'The dependency is present in initial browser traffic and the prepared expression evaluates to 3.'
    },
    repaired: {
      id: `${angularDependency.canonicalChallengeId}.repaired`,
      title: 'Expression workspace dependency-free control',
      route: angularDependency.repaired.targetRoute,
      visibleBehavior: 'The same supported expression evaluates to 3 without loading the client framework.'
    }
  },
  provenance: {
    legacyCaseIds: [],
    sourceIds: [],
    dependencyScenarioIds: [angularDependency.id]
  }
})

for (const dependencyScenario of scaDependencies.scenarios.filter((scenario) => scenario.canonicalChallengeId !== 'angular-expression-dependency')) {
  const challenge = challenges.find((candidate) => candidate.id === dependencyScenario.canonicalChallengeId)
  if (!challenge) throw new Error(`SCA dependency scenario references unknown challenge: ${dependencyScenario.id}`)
  challenge.provenance.dependencyScenarioIds = [...(challenge.provenance.dependencyScenarioIds || []), dependencyScenario.id]
}

for (const entry of cases) {
  if (consumedCaseIds.has(entry.id)) continue
  const source = sourceByCatalogId.get(entry.id)
  const isAtomic = source?.role === 'atomic-case'
  challenges.push({
    id: entry.id,
    kind: isAtomic ? 'atomic-observation' : 'advanced-lab',
    title: entry.title,
    summary: entry.description,
    category: entry.category,
    engines: [normalizeEngine(entry.engine)],
    availability: 'available',
    migrationStatus: isAtomic ? 'implemented-unpaired' : 'pending-split',
    suitability: {
      manual: entry.mode.includes('manual'),
      automation: entry.mode.includes('automation')
    },
    targets: {
      review: {
        id: entry.id,
        title: entry.title,
        route: entry.route,
        requirements: entry.requirements || []
      }
    },
    controlStatus: 'not-yet-paired',
    provenance: {
      legacyCaseIds: [entry.id],
      sourceIds: source ? [source.id] : [],
      scenarioCandidates: source?.scenarios?.length || 0
    }
  })
}

const representedAdvancedSources = new Set(challenges
  .filter((challenge) => challenge.kind === 'advanced-lab')
  .flatMap((challenge) => challenge.provenance.sourceIds || []))

function derivedChallengeIds(sourceIds) {
  const selected = new Set(sourceIds)
  return challenges
    .filter((challenge) => challenge.kind === 'atomic-challenge' || challenge.kind === 'atomic-observation')
    .filter((challenge) => (challenge.provenance.sourceIds || []).some((sourceId) => selected.has(sourceId)))
    .map((challenge) => challenge.id)
    .sort()
}

for (const challenge of challenges.filter((entry) => entry.kind === 'advanced-lab')) {
  const children = derivedChallengeIds(challenge.provenance.sourceIds || [])
  challenge.migrationStatus = 'compatibility-lab'
  challenge.controlStatus = children.length ? 'derived-controls-available' : 'not-applicable'
  challenge.provenance.derivedChallengeIds = children
}

for (const source of sourceLedger.sources.filter((entry) => entry.role === 'legacy-aggregate' && !representedAdvancedSources.has(entry.id))) {
  const canonicalPath = source.canonicalPath || source.path
  const engine = canonicalPath.startsWith('iast/') ? 'IAST' : canonicalPath.startsWith('sast/') ? 'SAST' : 'DAST'
  const children = derivedChallengeIds([source.id])
  challenges.push({
    id: `legacy.${slug(canonicalPath.replace(/\.html$/i, ''))}`,
    kind: 'advanced-lab',
    title: source.title,
    summary: 'A preserved historical multi-case page with its reviewed scenarios represented by focused canonical children.',
    category: 'Uncatalogued historical source',
    engines: [engine],
    availability: 'available',
    migrationStatus: 'compatibility-lab',
    suitability: {
      manual: true,
      automation: false
    },
    targets: {
      review: {
        id: source.id,
        title: source.title,
        route: source.route
      }
    },
    controlStatus: children.length ? 'derived-controls-available' : 'not-applicable',
    provenance: {
      legacyCaseIds: [],
      sourceIds: [source.id],
      scenarioCandidates: source.scenarios?.length || 0,
      derivedChallengeIds: children
    }
  })
}

const featuredOrder = new Map(missions.map((mission, index) => [mission.id, index]))
const kindOrder = new Map([['atomic-challenge', 0], ['atomic-observation', 1], ['advanced-lab', 2]])
challenges.sort((left, right) => {
  const leftFeatured = featuredOrder.has(left.id) ? featuredOrder.get(left.id) : Number.MAX_SAFE_INTEGER
  const rightFeatured = featuredOrder.has(right.id) ? featuredOrder.get(right.id) : Number.MAX_SAFE_INTEGER
  if (leftFeatured !== rightFeatured) return leftFeatured - rightFeatured
  const kindDifference = (kindOrder.get(left.kind) ?? 9) - (kindOrder.get(right.kind) ?? 9)
  if (kindDifference) return kindDifference
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
})

const familyMap = new Map()
for (const challenge of challenges) {
  const familyId = `family.${slug(challenge.category)}`
  challenge.familyId = familyId
  const family = familyMap.get(familyId) || {
    id: familyId,
    title: challenge.category,
    engines: new Set(),
    challengeIds: []
  }
  challenge.engines.forEach((engine) => family.engines.add(engine))
  family.challengeIds.push(challenge.id)
  familyMap.set(familyId, family)
}

const families = [...familyMap.values()]
  .map((family) => ({
    id: family.id,
    title: family.title,
    engines: [...family.engines].sort(),
    challengeIds: family.challengeIds.sort()
  }))
  .sort((left, right) => left.title.localeCompare(right.title))

const playlists = [
  {
    id: 'browser-context-demo',
    title: demo.title,
    summary: demo.summary,
    durationMinutes: demo.durationMinutes,
    challengeIds: demo.chapters.map((chapter) => chapter.missionId)
  },
  {
    id: 'current-browser-missions',
    title: 'Current browser-security missions',
    summary: 'Explore every implemented review and repaired mission without hiding the wider historical corpus.',
    challengeIds: missions.map((mission) => mission.id)
  },
  {
    id: 'static-to-runtime-evidence',
    title: 'From static code to runtime evidence',
    summary: 'Compare what browser-aware SAST can identify in collected code with what IAST proves only after state, responses and actions reach a live sink.',
    durationMinutes: 18,
    challengeIds: [
      'support-widget',
      'live-profile-preview',
      'saved-workspace',
      'transient-route-notice',
      'imported-request-preferences'
    ]
  },
  {
    id: 'browser-state-and-navigation',
    title: 'State, child documents and transient routes',
    summary: 'Follow browser-owned state across actions, a same-origin child document, imported configuration and a short-lived SPA route.',
    durationMinutes: 15,
    challengeIds: [
      'saved-workspace',
      'imported-request-preferences',
      'live-profile-preview',
      'transient-route-notice'
    ]
  },
  {
    id: 'browser-dast-evidence',
    title: 'DAST where the browser provides the request',
    summary: 'Compare response-only evidence, authenticated POST traffic and a transient client-side route that a URL-only scanner can miss.',
    durationMinutes: 14,
    challengeIds: [
      'deployment-response-boundary',
      'session-bound-order-search',
      'transient-route-notice'
    ]
  },
  {
    id: 'dependency-timing',
    title: 'Dependencies at load time and after interaction',
    summary: 'Exercise initial, action-loaded and end-of-life dependency cases with behavior-preserving controls.',
    durationMinutes: 10,
    challengeIds: [
      'support-widget',
      'on-demand-analytics',
      'angular-expression-dependency'
    ]
  },
  {
    id: 'spa-deep-dive',
    title: 'SPA Deep Dive',
    summary: 'Follow browser-owned navigation, late-loaded code and a causally related child tab across one focused three-mission journey.',
    durationMinutes: 18,
    challengeIds: [
      'history-order-router',
      'lazy-route-module',
      'same-origin-child-tab'
    ]
  }
]

const catalogCaseIds = cases.map((entry) => entry.id).sort()
const representedCaseIds = challenges.flatMap((challenge) => challenge.provenance.legacyCaseIds || []).sort()
if (JSON.stringify(catalogCaseIds) !== JSON.stringify(representedCaseIds)) {
  throw new Error('canonical challenge projection does not account for every legacy catalogue case exactly once')
}

const challengesDocument = {
  schema: 'owasp-ptk-playground-challenges/v1',
  version: 1,
  migrationStatus: 'full-corpus-fixtures-complete',
  summary: {
    challenges: challenges.length,
    atomic: challenges.filter((challenge) => challenge.kind === 'atomic-challenge').length,
    atomicObservations: challenges.filter((challenge) => challenge.kind === 'atomic-observation').length,
    advancedLabs: challenges.filter((challenge) => challenge.kind === 'advanced-lab').length,
    legacyCatalogueCases: catalogCaseIds.length,
    sourceLedgerFiles: sourceLedger.summary.sourceFiles,
    authoredSourceFiles: sourceLedger.summary.authoredSourceFiles,
    generatedAtomicSast: atomicSast.summary.challenges,
    generatedAtomicIast: atomicIast.summary.challenges,
    dastRuntimeTargets: dastContracts.summary.securityTargets - dastContracts.summary.controls,
    dastRuntimeRoutes: dastContracts.summary.runtimeRoutes,
    scaPackages: scaDependencies.summary.packages,
    scaScenarios: scaDependencies.summary.scenarios,
    classifiedScenarioMarkers: sourceLedger.summary.scenarios.reviewedMarkers,
    retainedAggregateAssertions: sourceLedger.summary.scenarios.retainedAggregateAssertions,
    pendingScenarioReview: sourceLedger.summary.scenarios.pendingManual
  },
  challenges
}

const familiesDocument = {
  schema: 'owasp-ptk-playground-families/v1',
  version: 1,
  families
}

const playlistsDocument = {
  schema: 'owasp-ptk-playground-playlists/v1',
  version: 1,
  playlists
}

const scannerTargetsDocument = {
  schema: 'owasp-ptk-playground-scanner-targets/v2',
  version: 2,
  generatedFrom: 'catalog/challenges.json',
  summary: {
    challenges: challenges.length,
    targets: challenges.reduce((total, challenge) => total + (challenge.targets.repaired ? 2 : 1), 0)
  },
  targets: challenges.flatMap((challenge) => [
    {
      id: challenge.targets.review.id,
      challengeId: challenge.id,
      variant: 'review',
      title: challenge.targets.review.title,
      engines: challenge.engines,
      route: challenge.targets.review.route,
      ...(challenge.targets.review.runtime ? { runtime: challenge.targets.review.runtime } : {}),
      ...(challenge.targets.review.request ? { request: challenge.targets.review.request } : {}),
      ...(challenge.targets.review.action ? { action: challenge.targets.review.action } : {}),
      ...(challenge.targets.review.journey ? { journey: challenge.targets.review.journey } : {}),
      ...(challenge.dependency ? {
        dependency: {
          name: challenge.dependency.name,
          version: challenge.dependency.reviewVersion
        }
      } : {})
    },
    ...(challenge.targets.repaired ? [{
      id: challenge.targets.repaired.id,
      challengeId: challenge.id,
      variant: 'repaired',
      title: challenge.targets.repaired.title,
      engines: challenge.engines,
      route: challenge.targets.repaired.route,
      ...(challenge.targets.repaired.runtime ? { runtime: challenge.targets.repaired.runtime } : {}),
      ...(challenge.targets.repaired.request ? { request: challenge.targets.repaired.request } : {}),
      ...(challenge.targets.repaired.action ? { action: challenge.targets.repaired.action } : {}),
      ...(challenge.targets.repaired.journey ? { journey: challenge.targets.repaired.journey } : {}),
      ...(challenge.dependency ? {
        dependency: {
          name: challenge.dependency.name,
          version: challenge.dependency.repairedVersion
        }
      } : {})
    }] : [])
  ])
}

const missionScannerDocument = {
  schema: 'owasp-browser-security-targets/v1',
  version: 1,
  missions: missions.map((mission) => ({
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
}

const countsDocument = {
  schema: 'owasp-ptk-playground-counts/v1',
  version: 1,
  challenges: challengesDocument.summary,
  targets: scannerTargetsDocument.summary.targets,
  engines: Object.fromEntries(['DAST', 'SAST', 'IAST', 'SCA'].map((engine) => [
    engine,
    challenges.filter((challenge) => challenge.engines.includes(engine)).length
  ])),
  migration: {
    classifiedScenarioMarkers: sourceLedger.summary.scenarios.reviewedMarkers,
    pendingScenarioReview: sourceLedger.summary.scenarios.pendingManual,
    retainedAggregateAssertions: sourceLedger.summary.scenarios.retainedAggregateAssertions,
    sourceMigrationComplete: sourceLedger.summary.migrationComplete
  }
}

publish('catalog/challenges.json', challengesDocument)
publish('catalog/families.json', familiesDocument)
publish('catalog/playlists.json', playlistsDocument)
publish('catalog/scanner-targets.json', missionScannerDocument)
publish('catalog/generated/scanner-targets.json', scannerTargetsDocument)
publish('catalog/generated/counts.json', countsDocument)

console.log(JSON.stringify({
  mode: checkOnly ? 'check' : 'write',
  challenges: challengesDocument.summary,
  families: families.length,
  playlists: playlists.length,
  scannerTargets: scannerTargetsDocument.summary.targets
}))
