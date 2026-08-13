const rootUrl = new URL('../../', import.meta.url)
const catalogUrl = new URL('catalog/cases.json', rootUrl)
const missionsUrl = new URL('catalog/missions.json', rootUrl)
const scannerTargetsUrl = new URL('catalog/scanner-targets.json', rootUrl)
const demoUrl = new URL('catalog/demo.json', rootUrl)
const pageRoot = document.documentElement

const engineLabels = {
  sast: 'SAST',
  iast: 'IAST',
  'dast-passive': 'Passive DAST'
}

let catalog = { cases: [] }
let missionCatalog = { missions: [] }
let scannerCatalog = { missions: [] }
let demoCatalog = { chapters: [] }
let passiveStatus = null
let homeCatalogueExpanded = false

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateCatalog(value) {
  if (!isPlainObject(value) || value.schema !== 'owasp-ptk-playground-catalog/v1' || !Array.isArray(value.cases)) {
    throw new Error('invalid_playground_catalog')
  }
  const ids = new Set()
  for (const entry of value.cases) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
      throw new Error('invalid_or_duplicate_case_id')
    }
    if (!engineLabels[entry.engine] || typeof entry.title !== 'string' || typeof entry.route !== 'string') {
      throw new Error(`invalid_case:${entry.id}`)
    }
    ids.add(entry.id)
  }
  return value
}

async function loadCatalog() {
  const response = await fetch(catalogUrl, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`catalog_http_${response.status}`)
  return validateCatalog(await response.json())
}

function isLocalRoute(value) {
  return typeof value === 'string' && (value.startsWith('./') || value.startsWith('/')) && !value.startsWith('//')
}

function validateMissionCatalog(value) {
  if (!isPlainObject(value) || value.schema !== 'owasp-browser-security-missions/v1' || !Array.isArray(value.missions)) {
    throw new Error('invalid_mission_catalog')
  }
  const ids = new Set()
  for (const mission of value.missions) {
    if (!isPlainObject(mission) || typeof mission.id !== 'string' || !mission.id || ids.has(mission.id)) {
      throw new Error('invalid_or_duplicate_mission_id')
    }
    if (typeof mission.title !== 'string' || typeof mission.story !== 'string' || !isLocalRoute(mission.route)) {
      throw new Error(`invalid_mission:${mission.id}`)
    }
    if (!Array.isArray(mission.objectives) || mission.objectives.length !== 3) {
      throw new Error(`invalid_mission_objectives:${mission.id}`)
    }
    if (!isLocalRoute(mission.targets?.review?.route) || !isLocalRoute(mission.targets?.repaired?.route)) {
      throw new Error(`invalid_mission_targets:${mission.id}`)
    }
    for (const target of Object.values(mission.targets)) {
      if (target.source !== undefined && !isLocalRoute(target.source)) throw new Error(`invalid_mission_source:${mission.id}`)
      if (target.runtime !== undefined && target.runtime?.kind !== 'route-aware-server') {
        throw new Error(`invalid_mission_runtime:${mission.id}`)
      }
      if (target.journey !== undefined && !isLocalRoute(target.journey?.childRoute)) {
        throw new Error(`invalid_mission_journey:${mission.id}`)
      }
      if (target.action !== undefined && (
        typeof target.action?.summary !== 'string' ||
        !target.action.summary ||
        typeof target.action?.triggerSelector !== 'string' ||
        !target.action.triggerSelector.startsWith('#') ||
        typeof target.action?.readySelector !== 'string' ||
        !target.action.readySelector.startsWith('#')
      )) {
        throw new Error(`invalid_mission_action:${mission.id}`)
      }
    }
    ids.add(mission.id)
  }
  return value
}

async function loadMissions() {
  const response = await fetch(missionsUrl, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`missions_http_${response.status}`)
  return validateMissionCatalog(await response.json())
}

function validateDemoCatalog(value) {
  if (!isPlainObject(value) || value.schema !== 'owasp-browser-security-demo/v1' || value.version !== 1) {
    throw new Error('invalid_demo_catalog')
  }
  if (typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || typeof value.summary !== 'string') {
    throw new Error('invalid_demo_identity')
  }
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || !Array.isArray(value.chapters) || !value.chapters.length) {
    throw new Error('invalid_demo_duration_or_chapters')
  }
  const chapterIds = new Set()
  for (const [index, chapter] of value.chapters.entries()) {
    if (!isPlainObject(chapter) || typeof chapter.id !== 'string' || !chapter.id || chapterIds.has(chapter.id)) {
      throw new Error('invalid_or_duplicate_demo_chapter')
    }
    if (chapter.number !== index + 1 || typeof chapter.missionId !== 'string' || typeof chapter.title !== 'string' || typeof chapter.summary !== 'string') {
      throw new Error(`invalid_demo_chapter:${chapter.id}`)
    }
    if (!Number.isInteger(chapter.durationMinutes) || chapter.durationMinutes < 1 || !Array.isArray(chapter.presenterSteps) || !chapter.presenterSteps.length) {
      throw new Error(`invalid_demo_chapter_steps:${chapter.id}`)
    }
    if (!Array.isArray(chapter.evidence) || !chapter.evidence.length || typeof chapter.browserAdvantage !== 'string') {
      throw new Error(`invalid_demo_chapter_evidence:${chapter.id}`)
    }
    for (const evidence of chapter.evidence) {
      if (!isPlainObject(evidence) || typeof evidence.engine !== 'string' || !evidence.engine || typeof evidence.observation !== 'string' || !evidence.observation) {
        throw new Error(`invalid_demo_evidence:${chapter.id}`)
      }
    }
    const checkpoint = chapter.checkpoint
    if (!isPlainObject(checkpoint) || typeof checkpoint.prompt !== 'string' || !Array.isArray(checkpoint.options) || checkpoint.options.length < 2) {
      throw new Error(`invalid_demo_checkpoint:${chapter.id}`)
    }
    const optionValues = new Set()
    for (const option of checkpoint.options) {
      if (!isPlainObject(option) || typeof option.value !== 'string' || !option.value || optionValues.has(option.value) || typeof option.label !== 'string') {
        throw new Error(`invalid_demo_checkpoint_option:${chapter.id}`)
      }
      optionValues.add(option.value)
    }
    if (!optionValues.has(checkpoint.answer)) throw new Error(`invalid_demo_checkpoint_answer:${chapter.id}`)
    chapterIds.add(chapter.id)
  }
  if (value.chapters.reduce((total, chapter) => total + chapter.durationMinutes, 0) !== value.durationMinutes) {
    throw new Error('invalid_demo_duration_total')
  }
  return value
}

async function loadDemoCatalog() {
  const response = await fetch(demoUrl, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`demo_http_${response.status}`)
  return validateDemoCatalog(await response.json())
}

function validateScannerCatalog(value) {
  if (!isPlainObject(value) || value.schema !== 'owasp-browser-security-targets/v1' || !Array.isArray(value.missions)) {
    throw new Error('invalid_scanner_catalog')
  }
  const missionIds = new Set()
  const targetIds = new Set()
  for (const mission of value.missions) {
    if (!isPlainObject(mission) || typeof mission.id !== 'string' || !mission.id || missionIds.has(mission.id)) {
      throw new Error('invalid_or_duplicate_scanner_mission_id')
    }
    if (typeof mission.title !== 'string' || typeof mission.summary !== 'string' || !isLocalRoute(mission.route)) {
      throw new Error(`invalid_scanner_mission:${mission.id}`)
    }
    if (!Array.isArray(mission.engines) || !mission.engines.length || !Array.isArray(mission.targets) || mission.targets.length !== 2) {
      throw new Error(`invalid_scanner_mission_contract:${mission.id}`)
    }
    const variants = new Set()
    for (const target of mission.targets) {
      if (!isPlainObject(target) || typeof target.id !== 'string' || !target.id || targetIds.has(target.id)) {
        throw new Error(`invalid_or_duplicate_scanner_target:${mission.id}`)
      }
      if (!['review', 'repaired'].includes(target.variant) || variants.has(target.variant) || !isLocalRoute(target.route)) {
        throw new Error(`invalid_scanner_target_contract:${target.id}`)
      }
      if (target.runtime !== undefined && target.runtime?.kind !== 'route-aware-server') {
        throw new Error(`invalid_scanner_runtime:${target.id}`)
      }
      if (target.journey !== undefined && !isLocalRoute(target.journey?.childRoute)) {
        throw new Error(`invalid_scanner_journey:${target.id}`)
      }
      if (target.action !== undefined && (
        typeof target.action?.summary !== 'string' ||
        !target.action.summary ||
        typeof target.action?.triggerSelector !== 'string' ||
        !target.action.triggerSelector.startsWith('#') ||
        typeof target.action?.readySelector !== 'string' ||
        !target.action.readySelector.startsWith('#')
      )) {
        throw new Error(`invalid_scanner_action:${target.id}`)
      }
      variants.add(target.variant)
      targetIds.add(target.id)
    }
    missionIds.add(mission.id)
  }
  return value
}

async function loadScannerTargets() {
  const response = await fetch(scannerTargetsUrl, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`scanner_targets_http_${response.status}`)
  return validateScannerCatalog(await response.json())
}

function element(tag, options = {}) {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = String(options.text)
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value))
    }
  }
  return node
}

function badge(text, kind) {
  return element('span', { className: `badge badge--${kind || 'default'}`, text })
}

function missionRoute(route) {
  return new URL(route.replace(/^\.\//, ''), rootUrl).href
}

function missionTargetUrl(target) {
  if (target.runtime?.kind !== 'route-aware-server') return missionRoute(target.route)
  if (!passiveStatus) return null
  const protocol = target.runtime.protocol === 'https' ? 'https' : 'http'
  const port = Number(target.runtime.port || (protocol === 'https' ? passiveStatus.httpsPort : passiveStatus.httpPort))
  const pathname = new URL(target.route.replace(/^\.\//, '/'), 'http://playground.test').pathname
  return new URL(pathname, `${protocol}://${window.location.hostname}:${port}`).href
}

function renderMissionList() {
  const container = document.querySelector('[data-mission-list]')
  if (!container) return
  container.replaceChildren()
  for (const mission of missionCatalog.missions) {
    const card = element('article', { className: 'mission-card', attributes: { 'data-mission-card': mission.id } })
    card.append(element('p', { className: 'eyebrow', text: mission.category }))
    card.append(element('h2', { text: mission.title }))
    card.append(element('p', { text: mission.summary }))

    const engines = element('div', { className: 'badge-row' })
    for (const engine of mission.engines || []) engines.append(badge(engine, engine === 'IAST' ? 'primary' : 'default'))
    card.append(engines)

    const facts = element('dl', { className: 'mission-card__facts' })
    const missionFacts = [
      ['Objectives', mission.objectives.length],
      ['Workflows', mission.modes.length]
    ]
    if (mission.dependency) missionFacts.push(['Dependency pair', `${mission.dependency.reviewVersion} → ${mission.dependency.repairedVersion}`])
    if (mission.evidenceSummary) missionFacts.push(['Evidence', mission.evidenceSummary])
    for (const [label, value] of missionFacts) {
      facts.append(element('dt', { text: label }), element('dd', { text: value }))
    }
    card.append(facts)
    card.append(element('a', {
      className: 'button',
      text: 'Start mission',
      attributes: { href: missionRoute(mission.route) }
    }))
    container.append(card)
  }
}

const missionModeDescriptions = {
  campaign: 'Complete objectives in order and use the visible evidence tokens to progress.',
  explorer: 'Every objective, hint, source and target is available without unlocks.',
  demo: 'Follow the presenter cues to explain how browser evidence fits together.',
  scanner: 'Use stable direct targets and neutral metadata without gameplay state.'
}

function progressKey(missionId) {
  return `owasp-browser-security-campaign/v1:${missionId}`
}

function readMissionProgress(mission) {
  try {
    const raw = window.sessionStorage.getItem(progressKey(mission.id))
    const parsed = raw ? JSON.parse(raw) : {}
    const objectiveIds = new Set(mission.objectives.map((objective) => objective.id))
    const completed = Array.isArray(parsed.completed)
      ? parsed.completed.filter((id) => objectiveIds.has(id))
      : []
    const mode = Object.hasOwn(missionModeDescriptions, parsed.mode) ? parsed.mode : 'campaign'
    return { completed: new Set(completed), mode }
  } catch {
    return { completed: new Set(), mode: 'campaign' }
  }
}

function saveMissionProgress(mission, state) {
  try {
    window.sessionStorage.setItem(progressKey(mission.id), JSON.stringify({
      completed: [...state.completed],
      mode: state.mode
    }))
  } catch {
    // The mission remains usable when session storage is unavailable.
  }
}

function objectiveTarget(mission, objective) {
  return objective.id === 'fix' ? mission.targets.repaired : mission.targets.review
}

function announceMission(message) {
  const announcement = document.querySelector('[data-mission-announcement]')
  if (announcement) announcement.textContent = message
}

function renderObjectiveCompletion(mission, objective, state, onComplete) {
  const completion = objective.completion
  const form = element('form', { className: 'objective-completion' })
  const label = element('label', {
    text: completion.prompt,
    attributes: { for: `objective-answer-${objective.id}` }
  })
  form.append(label)

  let control
  if (completion.type === 'choice') {
    control = element('select', {
      attributes: { id: `objective-answer-${objective.id}`, required: 'required' }
    })
    control.append(element('option', { text: 'Choose an observation', attributes: { value: '' } }))
    for (const option of completion.options || []) {
      control.append(element('option', { text: option.label, attributes: { value: option.value } }))
    }
  } else {
    control = element('input', {
      attributes: {
        id: `objective-answer-${objective.id}`,
        type: 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: completion.placeholder || completion.value || 'Enter visible evidence',
        required: 'required'
      }
    })
  }
  form.append(control)

  const feedback = element('p', { className: 'objective-feedback', attributes: { 'aria-live': 'polite' } })
  const submit = element('button', { className: 'button', text: 'Verify objective', attributes: { type: 'submit' } })
  form.append(submit, feedback)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const submitted = String(control.value || '').trim()
    const expected = completion.type === 'choice' ? completion.answer : completion.value
    if (submitted !== expected) {
      feedback.textContent = completion.type === 'choice'
        ? 'That answer does not match the mission evidence. Review the target and try again.'
        : 'That token does not match the visible target evidence.'
      feedback.dataset.status = 'error'
      return
    }
    feedback.textContent = 'Objective verified.'
    feedback.dataset.status = 'success'
    onComplete()
  })
  return form
}

function renderMissionObjectives(mission, state) {
  const container = document.querySelector('[data-mission-objectives]')
  if (!container) return
  container.replaceChildren()

  mission.objectives.forEach((objective, index) => {
    const previous = mission.objectives[index - 1]
    const unlocked = state.mode !== 'campaign' || !previous || state.completed.has(previous.id)
    const completed = state.completed.has(objective.id)
    const card = element('article', {
      className: `objective-card${unlocked ? '' : ' objective-card--locked'}${completed ? ' objective-card--complete' : ''}`,
      attributes: {
        'data-objective-id': objective.id,
        'data-objective-state': completed ? 'complete' : unlocked ? 'available' : 'locked'
      }
    })

    const heading = element('div', { className: 'objective-card__heading' })
    heading.append(element('span', { className: 'objective-number', text: objective.number }))
    const title = element('div')
    title.append(element('p', { className: 'eyebrow', text: completed ? 'Complete' : unlocked ? 'Available' : 'Locked' }))
    title.append(element('h3', { text: objective.title }))
    heading.append(title)
    card.append(heading)
    card.append(element('p', { className: 'objective-card__summary', text: objective.summary }))

    if (!unlocked) {
      card.append(element('p', { className: 'objective-lock', text: `Complete ${previous.title} to unlock this objective.` }))
      container.append(card)
      return
    }

    const instructions = element('ol', { className: 'objective-steps' })
    for (const instruction of objective.instructions || []) instructions.append(element('li', { text: instruction }))
    card.append(instructions)

    const concepts = element('div', { className: 'badge-row' })
    for (const concept of objective.concepts || []) concepts.append(badge(concept, 'default'))
    card.append(concepts)

    const target = objectiveTarget(mission, objective)
    const actions = element('div', { className: 'objective-actions' })
    const targetUrl = missionTargetUrl(target)
    actions.append(element('a', targetUrl ? {
      className: 'button',
      text: objective.id === 'fix' ? 'Open repaired target' : 'Open review target',
      attributes: { href: targetUrl, target: '_blank', rel: 'noopener' }
    } : {
      className: 'button button--secondary',
      text: 'Start route-aware server',
      attributes: { href: '#mission-server' }
    }))
    if (target.source) {
      actions.append(element('a', {
        className: 'button button--secondary',
        text: 'View source',
        attributes: { href: missionRoute(target.source), target: '_blank', rel: 'noopener' }
      }))
    }
    card.append(actions)

    const hint = element('details', { className: 'objective-hint' })
    hint.append(element('summary', { text: 'Show hint' }), element('p', { text: objective.hint }))
    card.append(hint)

    if (state.mode === 'demo') {
      const cue = element('aside', { className: 'demo-cue' })
      cue.append(element('strong', { text: 'Presenter cue' }), element('p', { text: objective.demoCue }))
      card.append(cue)
    }

    if (completed) {
      card.append(element('p', { className: 'objective-complete-message', text: 'Objective verified for this browser session.' }))
    } else {
      card.append(renderObjectiveCompletion(mission, objective, state, () => {
        state.completed.add(objective.id)
        saveMissionProgress(mission, state)
        announceMission(`${objective.title} complete.`)
        renderMission(mission, state)
      }))
    }
    container.append(card)
  })
}

function renderScannerTargets(mission) {
  const container = document.querySelector('[data-scanner-targets]')
  if (!container) return
  container.replaceChildren()
  for (const [variant, target] of Object.entries(mission.targets)) {
    const card = element('article', { className: 'scanner-target-card' })
    card.append(element('p', { className: 'eyebrow', text: variant === 'review' ? 'Review target' : 'Repaired control' }))
    card.append(element('h3', { text: target.title || (variant === 'review' ? 'Review route' : 'Repaired route') }))
    card.append(element('p', { text: target.visibleBehavior }))
    card.append(element('code', { className: 'scanner-route', text: target.displayRoute }))
    if (target.request) {
      const requestFacts = element('dl', { className: 'mission-card__facts' })
      for (const [label, value] of [
        ['Method', target.request.method],
        ['Encoding', target.request.contentType],
        ['Parameters', (target.request.parameterNames || []).join(', ')]
      ]) {
        requestFacts.append(element('dt', { text: label }), element('dd', { text: value }))
      }
      card.append(requestFacts)
      card.append(element('code', { className: 'scanner-route', text: target.request.route }))
      card.append(element('p', { text: target.request.setup }))
    }
    if (target.journey) {
      const journeyFacts = element('dl', { className: 'mission-card__facts' })
      journeyFacts.append(element('dt', { text: 'Journey' }), element('dd', { text: 'Same-origin child document' }))
      card.append(journeyFacts)
      card.append(element('code', { className: 'scanner-route', text: target.journey.childRoute }))
      card.append(element('p', { text: target.journey.summary }))
    }
    if (target.action) {
      const actionFacts = element('dl', { className: 'mission-card__facts' })
      actionFacts.append(element('dt', { text: 'Interaction' }), element('dd', { text: 'Browser action required' }))
      card.append(actionFacts)
      card.append(element('code', { className: 'scanner-route', text: target.action.triggerSelector }))
      card.append(element('p', { text: target.action.summary }))
    }
    const actions = element('div', { className: 'objective-actions' })
    const targetUrl = missionTargetUrl(target)
    actions.append(element('a', targetUrl ? {
      className: 'button',
      text: 'Open target',
      attributes: { href: targetUrl, target: '_blank', rel: 'noopener' }
    } : {
      className: 'button button--secondary',
      text: 'Start route-aware server',
      attributes: { href: '#mission-server' }
    }))
    if (target.source) {
      actions.append(element('a', {
        className: 'button button--secondary',
        text: 'Open source',
        attributes: { href: missionRoute(target.source), target: '_blank', rel: 'noopener' }
      }))
    }
    card.append(actions)
    container.append(card)
  }
}

function scannerDirectoryFilters() {
  return {
    search: document.querySelector('[data-scanner-filter="search"]')?.value.trim().toLowerCase() || '',
    engine: document.querySelector('[data-scanner-filter="engine"]')?.value || '',
    runtime: document.querySelector('[data-scanner-filter="runtime"]')?.value || ''
  }
}

function scannerMissionMatches(mission, filters) {
  if (filters.engine && !mission.engines.includes(filters.engine)) return false
  if (filters.runtime) {
    const hasRuntime = mission.targets.some((target) => {
      const runtime = target.runtime?.kind || 'static'
      return runtime === filters.runtime
    })
    if (!hasRuntime) return false
  }
  if (!filters.search) return true
  const haystack = [
    mission.id,
    mission.title,
    mission.summary,
    mission.category,
    ...(mission.engines || []),
    ...mission.targets.flatMap((target) => [target.id, target.title, target.displayRoute, target.visibleBehavior])
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(filters.search)
}

function renderScannerDirectoryTarget(target) {
  const card = element('article', {
    className: 'scanner-target-card scanner-directory__target',
    attributes: { 'data-scanner-target': target.id, 'data-target-variant': target.variant }
  })
  card.append(element('p', {
    className: 'eyebrow',
    text: target.variant === 'review' ? 'Review target' : 'Repaired control'
  }))
  card.append(element('h3', { text: target.title }))
  card.append(element('p', { text: target.visibleBehavior }))
  card.append(element('code', { className: 'scanner-route', text: target.displayRoute }))

  const facts = element('dl', { className: 'mission-card__facts scanner-target-facts' })
  const runtime = target.runtime?.kind === 'route-aware-server' ? 'Route-aware server' : 'Static hosting'
  const targetFacts = [['Runtime', runtime]]
  if (target.dependency) targetFacts.push(['Dependency', `${target.dependency.name} ${target.dependency.version}`])
  if (target.request) {
    targetFacts.push(['Request', `${target.request.method} ${target.request.contentType}`])
    targetFacts.push(['Parameters', (target.request.parameterNames || []).join(', ')])
  }
  if (target.journey) {
    targetFacts.push(['Journey', 'Same-origin child document'])
  }
  if (target.action) {
    targetFacts.push(['Interaction', 'Browser action required'])
  }
  for (const [label, value] of targetFacts) {
    facts.append(element('dt', { text: label }), element('dd', { text: value }))
  }
  card.append(facts)
  if (target.request) {
    card.append(element('code', { className: 'scanner-route', text: target.request.route }))
    card.append(element('p', { className: 'scanner-setup', text: target.request.setup }))
  }
  if (target.journey) {
    card.append(element('code', { className: 'scanner-route', text: target.journey.childRoute }))
    card.append(element('p', { className: 'scanner-setup', text: target.journey.summary }))
  }
  if (target.action) {
    card.append(element('code', { className: 'scanner-route', text: target.action.triggerSelector }))
    card.append(element('p', { className: 'scanner-setup', text: target.action.summary }))
  }

  const actions = element('div', { className: 'objective-actions' })
  const targetUrl = missionTargetUrl(target)
  actions.append(element('a', targetUrl ? {
    className: 'button',
    text: 'Open target',
    attributes: { href: targetUrl, target: '_blank', rel: 'noopener' }
  } : {
    className: 'button button--secondary',
    text: 'Start route-aware server',
    attributes: { href: '#scanner-server' }
  }))
  const copyButton = element('button', {
    className: 'button button--secondary',
    text: 'Copy route',
    attributes: { type: 'button' }
  })
  copyButton.addEventListener('click', () => copyText(targetUrl || target.displayRoute, copyButton))
  actions.append(copyButton)
  card.append(actions)
  return card
}

function renderScannerDirectory() {
  const container = document.querySelector('[data-scanner-directory]')
  if (!container) return
  const filters = scannerDirectoryFilters()
  const missions = scannerCatalog.missions.filter((mission) => scannerMissionMatches(mission, filters))
  container.replaceChildren()
  for (const mission of missions) {
    const section = element('section', {
      className: 'scanner-directory__mission',
      attributes: { 'data-scanner-mission': mission.id }
    })
    const heading = element('div', { className: 'scanner-directory__heading' })
    const copy = element('div')
    copy.append(element('p', { className: 'eyebrow', text: mission.category }))
    copy.append(element('h3', { text: mission.title }))
    copy.append(element('p', { text: mission.summary }))
    heading.append(copy)
    const engines = element('div', { className: 'badge-row' })
    for (const engine of mission.engines) engines.append(badge(engine, engine === 'IAST' ? 'primary' : 'default'))
    heading.append(engines)
    section.append(heading)

    const targets = element('div', { className: 'scanner-target-grid' })
    for (const target of mission.targets) targets.append(renderScannerDirectoryTarget(target))
    section.append(targets)
    section.append(element('a', {
      className: 'scanner-mission-link',
      text: 'Open guided mission',
      attributes: { href: missionRoute(mission.route) }
    }))
    container.append(section)
  }
  if (!missions.length) {
    container.append(element('p', { className: 'empty-state', text: 'No scanner targets match these filters.' }))
  }
  const summary = document.querySelector('[data-scanner-summary]')
  if (summary) {
    const targets = missions.reduce((total, mission) => total + mission.targets.length, 0)
    summary.textContent = `${missions.length} mission${missions.length === 1 ? '' : 's'} · ${targets} paired target${targets === 1 ? '' : 's'}`
  }
}

function updateScannerRuntimeStatus() {
  const label = document.querySelector('[data-scanner-status]')
  const detail = document.querySelector('[data-scanner-status-detail]')
  const dot = document.querySelector('[data-scanner-status-dot]')
  if (!label) return
  if (passiveStatus) {
    label.textContent = 'Route-aware server detected'
    if (detail) detail.textContent = `HTTP :${passiveStatus.httpPort} and HTTPS :${passiveStatus.httpsPort} targets are available.`
    dot?.classList.add('status-dot--ready')
  } else {
    label.textContent = 'Static catalogue mode'
    if (detail) detail.textContent = 'Static targets are available. Route-aware targets remain disabled until this page is opened through the local server.'
    dot?.classList.remove('status-dot--ready')
  }
}

function bindScannerDirectoryFilters() {
  for (const control of document.querySelectorAll('[data-scanner-filter]')) {
    control.addEventListener(control.matches('input') ? 'input' : 'change', renderScannerDirectory)
  }
}

function updateMissionProgress(mission, state) {
  const count = state.completed.size
  const total = mission.objectives.length
  const countNode = document.querySelector('[data-progress-count]')
  const totalNode = document.querySelector('[data-progress-total]')
  const track = document.querySelector('[data-progress-track]')
  const bar = document.querySelector('[data-progress-bar]')
  if (countNode) countNode.textContent = String(count)
  if (totalNode) totalNode.textContent = String(total)
  if (track) {
    track.setAttribute('aria-valuemax', String(total))
    track.setAttribute('aria-valuenow', String(count))
  }
  if (bar) bar.style.width = `${total ? Math.round((count / total) * 100) : 0}%`
}

function renderMission(mission, state) {
  document.body.dataset.missionMode = state.mode
  const title = document.querySelector('[data-mission-title]')
  const story = document.querySelector('[data-mission-story]')
  const engines = document.querySelector('[data-mission-engines]')
  const modeDescription = document.querySelector('[data-mode-description]')
  if (title) title.textContent = mission.title
  if (story) story.textContent = mission.story
  if (engines) {
    engines.replaceChildren()
    for (const engine of mission.engines || []) engines.append(badge(engine, engine === 'IAST' ? 'primary' : 'default'))
  }
  if (modeDescription) modeDescription.textContent = missionModeDescriptions[state.mode]
  for (const button of document.querySelectorAll('[data-mission-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.missionMode === state.mode))
  }

  const scannerMode = state.mode === 'scanner'
  const objectivesSection = document.querySelector('.mission-objectives-section')
  const scannerPanel = document.querySelector('[data-scanner-panel]')
  const progressPanel = document.querySelector('.mission-progress')
  if (objectivesSection) objectivesSection.hidden = scannerMode
  if (scannerPanel) scannerPanel.hidden = !scannerMode
  if (progressPanel) progressPanel.hidden = scannerMode

  updateMissionProgress(mission, state)
  if (scannerMode) renderScannerTargets(mission)
  else renderMissionObjectives(mission, state)
}

function bindMission(mission) {
  const state = readMissionProgress(mission)
  const requestedMode = new URLSearchParams(window.location.search).get('mode')
  if (Object.hasOwn(missionModeDescriptions, requestedMode)) state.mode = requestedMode
  for (const button of document.querySelectorAll('[data-mission-mode]')) {
    button.addEventListener('click', () => {
      state.mode = button.dataset.missionMode
      saveMissionProgress(mission, state)
      renderMission(mission, state)
      announceMission(`${button.textContent} mode selected.`)
    })
  }
  document.querySelector('[data-reset-mission]')?.addEventListener('click', () => {
    state.completed.clear()
    saveMissionProgress(mission, state)
    renderMission(mission, state)
    announceMission('Mission progress reset.')
  })
  renderMission(mission, state)
}

function demoProgressKey(demo) {
  return `owasp-browser-security-demo/v1:${demo.id}`
}

function readDemoProgress(demo) {
  try {
    const raw = window.sessionStorage.getItem(demoProgressKey(demo))
    const parsed = raw ? JSON.parse(raw) : {}
    const chapterIds = new Set(demo.chapters.map((chapter) => chapter.id))
    const completed = Array.isArray(parsed.completed)
      ? parsed.completed.filter((id) => chapterIds.has(id))
      : []
    return { completed: new Set(completed) }
  } catch {
    return { completed: new Set() }
  }
}

function saveDemoProgress(demo, state) {
  try {
    window.sessionStorage.setItem(demoProgressKey(demo), JSON.stringify({ completed: [...state.completed] }))
  } catch {
    // Presentation remains usable when session storage is unavailable.
  }
}

function announceDemo(message) {
  const announcement = document.querySelector('[data-demo-announcement]')
  if (announcement) announcement.textContent = message
}

function updateDemoProgress(demo, state) {
  const count = state.completed.size
  const total = demo.chapters.length
  const countNode = document.querySelector('[data-demo-progress-count]')
  const totalNode = document.querySelector('[data-demo-progress-total]')
  const track = document.querySelector('[data-demo-progress-track]')
  const bar = document.querySelector('[data-demo-progress-bar]')
  const next = document.querySelector('[data-demo-progress-next]')
  const conclusion = document.querySelector('[data-demo-conclusion]')
  if (countNode) countNode.textContent = String(count)
  if (totalNode) totalNode.textContent = String(total)
  if (track) {
    track.setAttribute('aria-valuemax', String(total))
    track.setAttribute('aria-valuenow', String(count))
  }
  if (bar) bar.style.width = `${total ? Math.round((count / total) * 100) : 0}%`
  const nextChapter = demo.chapters.find((chapter) => !state.completed.has(chapter.id))
  if (next) next.textContent = nextChapter ? `Next: ${nextChapter.title}` : 'All chapters complete.'
  if (conclusion) conclusion.hidden = count !== total
}

function renderDemoTargetAction(mission, variant) {
  const target = mission.targets[variant]
  const targetUrl = missionTargetUrl(target)
  return element('a', targetUrl ? {
    className: `button${variant === 'repaired' ? ' button--secondary' : ''}`,
    text: variant === 'review' ? 'Open review target' : 'Open repaired target',
    attributes: {
      href: targetUrl,
      target: '_blank',
      rel: 'noopener',
      'data-demo-target': target.id,
      'data-target-variant': variant
    }
  } : {
    className: 'button button--secondary',
    text: 'Start route-aware server',
    attributes: {
      href: '#demo-server',
      'data-demo-target-disabled': target.id,
      'data-target-variant': variant
    }
  })
}

function renderDemoCheckpoint(demo, chapter, state, onComplete) {
  const form = element('form', {
    className: 'demo-checkpoint',
    attributes: { 'data-demo-checkpoint': chapter.id }
  })
  const selectId = `demo-checkpoint-${chapter.id}`
  const label = element('label', { text: chapter.checkpoint.prompt, attributes: { for: selectId } })
  const select = element('select', { attributes: { id: selectId, required: 'required' } })
  select.append(element('option', { text: 'Choose an observation', attributes: { value: '' } }))
  for (const option of chapter.checkpoint.options) {
    select.append(element('option', { text: option.label, attributes: { value: option.value } }))
  }
  const submit = element('button', { className: 'button', text: 'Confirm chapter', attributes: { type: 'submit' } })
  const feedback = element('p', { className: 'objective-feedback', attributes: { 'aria-live': 'polite' } })
  form.append(label, select, submit, feedback)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (select.value !== chapter.checkpoint.answer) {
      feedback.textContent = 'That answer does not use the complete browser evidence. Review the chapter and try again.'
      feedback.dataset.status = 'error'
      return
    }
    state.completed.add(chapter.id)
    saveDemoProgress(demo, state)
    feedback.textContent = 'Chapter complete.'
    feedback.dataset.status = 'success'
    onComplete()
  })
  return form
}

function renderDemoChapters(demo, state) {
  const container = document.querySelector('[data-demo-chapters]')
  if (!container) return
  container.replaceChildren()
  for (const chapter of demo.chapters) {
    const mission = missionCatalog.missions.find((entry) => entry.id === chapter.missionId)
    if (!mission) throw new Error(`demo_mission_not_found:${chapter.missionId}`)
    const completed = state.completed.has(chapter.id)
    const card = element('article', {
      className: `demo-chapter${completed ? ' demo-chapter--complete' : ''}`,
      attributes: { 'data-demo-chapter': chapter.id, 'data-chapter-state': completed ? 'complete' : 'available' }
    })

    const header = element('header', { className: 'demo-chapter__header' })
    const number = element('span', { className: 'demo-chapter__number', text: chapter.number })
    const heading = element('div')
    heading.append(element('p', { className: 'eyebrow', text: `${chapter.durationMinutes} minutes · ${mission.category}` }))
    heading.append(element('h3', { text: chapter.title }))
    heading.append(element('p', { text: chapter.summary }))
    header.append(number, heading)
    const status = element('span', {
      className: `status-pill${completed ? ' status-pill--safe' : ''}`,
      text: completed ? 'Complete' : 'Ready'
    })
    header.append(status)
    card.append(header)

    const engines = element('div', { className: 'badge-row demo-chapter__engines' })
    for (const engine of mission.engines) engines.append(badge(engine, engine === 'IAST' ? 'primary' : engine === 'DAST' ? 'mixed' : 'default'))
    card.append(engines)

    const body = element('div', { className: 'demo-chapter__body' })
    const presenter = element('section', { className: 'demo-presenter' })
    presenter.append(element('h4', { text: 'Presenter path' }))
    const steps = element('ol', { className: 'objective-steps' })
    for (const step of chapter.presenterSteps) steps.append(element('li', { text: step }))
    presenter.append(steps)
    const actions = element('div', { className: 'objective-actions' })
    actions.append(renderDemoTargetAction(mission, 'review'), renderDemoTargetAction(mission, 'repaired'))
    actions.append(element('a', {
      className: 'button button--secondary',
      text: 'Open guided mission',
      attributes: { href: `${missionRoute(mission.route)}?mode=demo`, 'data-demo-mission-link': mission.id }
    }))
    presenter.append(actions)

    const evidencePanel = element('section', { className: 'demo-evidence' })
    evidencePanel.append(element('h4', { text: 'What to correlate' }))
    const evidenceList = element('div', { className: 'demo-evidence__list' })
    for (const evidence of chapter.evidence) {
      const item = element('div', { className: 'demo-evidence__item' })
      item.append(badge(evidence.engine, evidence.engine === 'IAST' ? 'primary' : evidence.engine === 'DAST' ? 'mixed' : 'default'))
      item.append(element('p', { text: evidence.observation }))
      evidenceList.append(item)
    }
    evidencePanel.append(evidenceList)
    const advantage = element('aside', { className: 'demo-cue' })
    advantage.append(element('strong', { text: 'Why browser context matters' }), element('p', { text: chapter.browserAdvantage }))
    evidencePanel.append(advantage)
    body.append(presenter, evidencePanel)
    card.append(body)

    if (completed) {
      card.append(element('p', { className: 'objective-complete-message demo-chapter__complete', text: 'Presentation checkpoint complete for this browser session.' }))
    } else {
      card.append(renderDemoCheckpoint(demo, chapter, state, () => {
        announceDemo(`${chapter.title} complete.`)
        renderDemoChapters(demo, state)
      }))
    }
    container.append(card)
  }
  updateDemoProgress(demo, state)
}

function updateDemoRuntimeStatus() {
  const label = document.querySelector('[data-demo-status]')
  const detail = document.querySelector('[data-demo-status-detail]')
  const dot = document.querySelector('[data-demo-status-dot]')
  if (!label) return
  if (passiveStatus) {
    label.textContent = 'Full demo runtime detected'
    if (detail) detail.textContent = `All target links are ready. HTTP :${passiveStatus.httpPort}; HTTPS :${passiveStatus.httpsPort}.`
    dot?.classList.add('status-dot--ready')
  } else {
    label.textContent = 'Static demo mode'
    if (detail) detail.textContent = 'Static chapters are ready. Start the local runtime to enable the session-bound review and repaired targets.'
    dot?.classList.remove('status-dot--ready')
  }
}

function initDemoPage() {
  for (const chapter of demoCatalog.chapters) {
    if (!missionCatalog.missions.some((mission) => mission.id === chapter.missionId)) {
      throw new Error(`demo_mission_not_found:${chapter.missionId}`)
    }
  }
  const title = document.querySelector('[data-demo-title]')
  const summary = document.querySelector('[data-demo-summary]')
  if (title) title.textContent = demoCatalog.title
  if (summary) summary.textContent = demoCatalog.summary
  const state = readDemoProgress(demoCatalog)
  document.querySelector('[data-reset-demo]')?.addEventListener('click', () => {
    state.completed.clear()
    saveDemoProgress(demoCatalog, state)
    renderDemoChapters(demoCatalog, state)
    announceDemo('Demo progress reset.')
  })
  updateDemoRuntimeStatus()
  renderDemoChapters(demoCatalog, state)
}

function updateMissionServerPanel(mission) {
  const panel = document.querySelector('[data-route-server-panel]')
  if (!panel) return
  const requiresServer = Object.values(mission.targets || {}).some((target) => target.runtime?.kind === 'route-aware-server')
  panel.hidden = !requiresServer || Boolean(passiveStatus)
  const status = panel.querySelector('[data-route-server-status]')
  if (status && requiresServer) {
    status.textContent = passiveStatus
      ? 'Route-aware server detected.'
      : 'This mission needs the local route-aware server to reproduce its browser and server behavior.'
  }
}

function initMissionPage() {
  const missionId = document.body.dataset.missionId
  const mission = missionCatalog.missions.find((entry) => entry.id === missionId)
  if (!mission) throw new Error(`mission_not_found:${missionId}`)
  updateMissionServerPanel(mission)
  bindMission(mission)
}

function catalogueFilters() {
  return {
    search: document.querySelector('[data-filter="search"]')?.value.trim().toLowerCase() || '',
    engine: document.querySelector('[data-filter="engine"]')?.value || '',
    mode: document.querySelector('[data-filter="mode"]')?.value || ''
  }
}

function matchesFilters(entry, filters) {
  if (filters.engine && entry.engine !== filters.engine) return false
  if (filters.mode && !entry.mode.includes(filters.mode)) return false
  if (!filters.search) return true
  const haystack = [entry.id, entry.title, entry.description, entry.category, entry.route, ...(entry.mode || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(filters.search)
}

async function detectPassiveServer() {
  const port = Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 80))
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return null
  if (![3080, 3443].includes(port)) return null
  return { schema: 'owasp-ptk-passive-server/v1', httpPort: 3080, httpsPort: 3443 }
}

function passiveCaseUrl(entry) {
  if (!passiveStatus) return null
  const protocol = entry.protocol === 'https' ? 'https' : 'http'
  const port = protocol === 'https' ? passiveStatus.httpsPort : passiveStatus.httpPort
  return new URL(entry.route, `${protocol}://${window.location.hostname}:${port}`).href
}

function routeFor(entry) {
  if (entry.engine === 'dast-passive') return passiveCaseUrl(entry)
  return new URL(entry.route.replace(/^\.\//, ''), rootUrl).href
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text)
    const previous = button.textContent
    button.textContent = 'Copied'
    window.setTimeout(() => { button.textContent = previous }, 1400)
  } catch {
    button.textContent = 'Copy failed'
  }
}

function renderCase(entry) {
  const card = element('article', {
    className: 'case-card',
    attributes: { 'data-case-id': entry.id, 'data-engine': entry.engine }
  })
  card.append(element('div', { className: 'case-card__category', text: entry.category }))

  const title = element('h3')
  const url = routeFor(entry)
  if (url) {
    title.append(element('a', { text: entry.title, attributes: { href: url } }))
  } else {
    title.textContent = entry.title
  }
  card.append(title)
  card.append(element('p', { text: entry.description }))

  const badges = element('div', { className: 'badge-row' })
  for (const mode of entry.mode) badges.append(badge(mode, 'default'))
  card.append(badges)

  const routeLabel = entry.routeLabel || entry.route.replace(/^\.\//, '/')
  card.append(element('div', { className: 'case-card__route', text: routeLabel }))

  const actions = element('div', { className: 'case-card__actions' })
  if (url) {
    actions.append(element('a', {
      className: 'button',
      text: entry.mode.includes('automation') && !entry.mode.includes('manual') ? 'Open canary' : 'Open case',
      attributes: { href: url }
    }))
  } else {
    actions.append(element('a', {
      className: 'button button--secondary',
      text: 'Start local server',
      attributes: { href: '#local-server' }
    }))
  }

  const copyButton = element('button', {
    className: 'button button--secondary',
    text: 'Copy route',
    attributes: { type: 'button' }
  })
  copyButton.addEventListener('click', () => copyText(url || routeLabel, copyButton))
  actions.append(copyButton)
  card.append(actions)
  return card
}

function renderCatalogue() {
  const container = document.querySelector('[data-case-catalogue]')
  if (!container) return
  const fixedEngine = container.dataset.engine || ''
  const filters = catalogueFilters()
  if (fixedEngine) filters.engine = fixedEngine
  const matchingEntries = catalog.cases.filter((entry) => matchesFilters(entry, filters))
  const isHomeCatalogue = document.body.dataset.page === 'home' && !fixedEngine
  const hasActiveFilters = Boolean(filters.search || filters.engine || filters.mode)
  const showCuratedHome = isHomeCatalogue && !hasActiveFilters && !homeCatalogueExpanded
  const entries = showCuratedHome
    ? Object.keys(engineLabels).flatMap((engine) => matchingEntries.filter((entry) => entry.engine === engine).slice(0, 4))
    : matchingEntries
  container.replaceChildren()
  if (!entries.length) {
    container.append(element('p', {
      className: 'empty-state',
      text: 'No cases match these filters.'
    }))
  } else {
    for (const entry of entries) container.append(renderCase(entry))
  }
  const summary = document.querySelector('[data-catalogue-summary]')
  if (summary) {
    const total = fixedEngine ? catalog.cases.filter((entry) => entry.engine === fixedEngine).length : catalog.cases.length
    summary.textContent = showCuratedHome
      ? `${entries.length} curated cases from ${total}`
      : `${matchingEntries.length} of ${total} cases`
  }

  const showAll = document.querySelector('[data-show-all-cases]')
  if (showAll) {
    showAll.hidden = !showCuratedHome
    showAll.textContent = `Show all ${catalog.cases.length} cases`
  }
}

function updateCounts() {
  for (const node of document.querySelectorAll('[data-case-count]')) {
    const engine = node.dataset.caseCount
    const count = catalog.cases.filter((entry) => !engine || entry.engine === engine).length
    node.textContent = String(count)
  }
}

function updatePassiveStatus() {
  const label = document.querySelector('[data-passive-status]')
  const dot = document.querySelector('[data-passive-status-dot]')
  const detail = document.querySelector('[data-passive-detail]')
  if (!label) return
  if (passiveStatus) {
    label.textContent = 'Runnable mode'
    dot?.classList.add('status-dot--ready')
    if (detail) detail.textContent = `Route server detected. HTTP :${passiveStatus.httpPort}; HTTPS :${passiveStatus.httpsPort} when available.`
  } else {
    label.textContent = 'Catalogue mode'
    dot?.classList.remove('status-dot--ready')
    if (detail) detail.textContent = 'The route-aware server is not active on this origin. Case cards show routes without redirecting this public page to localhost.'
  }
}

function bindFilters() {
  for (const control of document.querySelectorAll('[data-filter]')) {
    control.addEventListener(control.matches('input') ? 'input' : 'change', renderCatalogue)
  }
  const showAll = document.querySelector('[data-show-all-cases]')
  showAll?.addEventListener('click', () => {
    homeCatalogueExpanded = true
    renderCatalogue()
  })
}

function showCatalogError(error) {
  const container = document.querySelector('[data-case-catalogue]')
  if (container) {
    container.replaceChildren(element('p', {
      className: 'empty-state',
      text: 'The case catalogue could not be loaded. Use the repository README for direct fixture paths.'
    }))
  }
  const scannerContainer = document.querySelector('[data-scanner-directory]')
  if (scannerContainer) {
    scannerContainer.replaceChildren(element('p', {
      className: 'empty-state',
      text: 'The scanner target directory could not be loaded. Use the repository README for direct target paths.'
    }))
  }
  const demoContainer = document.querySelector('[data-demo-chapters]')
  if (demoContainer) {
    demoContainer.replaceChildren(element('p', {
      className: 'empty-state',
      text: 'The demo journey could not be loaded. Use the campaign directory to open each mission directly.'
    }))
  }
  pageRoot.dataset.catalogStatus = 'error'
  console.error('[ptk-playground] catalog load failed', error)
}

async function init() {
  try {
    if (document.body.dataset.page === 'demo') {
      [missionCatalog, demoCatalog] = await Promise.all([loadMissions(), loadDemoCatalog()])
      passiveStatus = await detectPassiveServer()
      initDemoPage()
      pageRoot.dataset.catalogStatus = 'ready'
      return
    }
    if (document.body.dataset.page === 'scanner') {
      scannerCatalog = await loadScannerTargets()
      passiveStatus = await detectPassiveServer()
      updateScannerRuntimeStatus()
      bindScannerDirectoryFilters()
      renderScannerDirectory()
      pageRoot.dataset.catalogStatus = 'ready'
      return
    }
    if (['campaigns', 'mission'].includes(document.body.dataset.page)) {
      missionCatalog = await loadMissions()
      passiveStatus = await detectPassiveServer()
      if (document.body.dataset.page === 'campaigns') renderMissionList()
      else initMissionPage()
      pageRoot.dataset.catalogStatus = 'ready'
      return
    }
    catalog = await loadCatalog()
    if (document.body.dataset.engine === 'dast-passive' || catalog.cases.some((entry) => entry.engine === 'dast-passive')) {
      passiveStatus = await detectPassiveServer()
    }
    updateCounts()
    updatePassiveStatus()
    bindFilters()
    renderCatalogue()
    pageRoot.dataset.catalogStatus = 'ready'
  } catch (error) {
    showCatalogError(error)
  }
}

init()
