const rootUrl = new URL('../../', import.meta.url)
const challengesUrl = new URL('catalog/challenges.json', rootUrl)
const familiesUrl = new URL('catalog/families.json', rootUrl)
const playlistsUrl = new URL('catalog/playlists.json', rootUrl)

let challengeCatalog = { challenges: [], summary: {} }
let familyCatalog = { families: [] }
let playlistCatalog = { playlists: [] }
const explorePageSize = 24
let exploreVisibleLimit = explorePageSize
let exploreSourceId = ''

function element(tag, options = {}) {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = String(options.text)
  for (const [name, value] of Object.entries(options.attributes || {})) {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value))
  }
  return node
}

function badge(text, kind = 'default') {
  return element('span', { className: `badge badge--${kind}`, text })
}

function isLocalRoute(route) {
  return typeof route === 'string' && (route.startsWith('./') || route.startsWith('/')) && !route.startsWith('//')
}

function validateChallenges(value) {
  if (value?.schema !== 'owasp-ptk-playground-challenges/v1' || !Array.isArray(value.challenges)) {
    throw new Error('invalid_challenge_catalog')
  }
  const ids = new Set()
  for (const challenge of value.challenges) {
    if (!challenge?.id || ids.has(challenge.id) || !challenge.title || !challenge.summary) {
      throw new Error('invalid_or_duplicate_challenge')
    }
    if (!isLocalRoute(challenge.targets?.review?.route)) throw new Error(`invalid_review_target:${challenge.id}`)
    if (challenge.targets?.repaired && !isLocalRoute(challenge.targets.repaired.route)) {
      throw new Error(`invalid_repaired_target:${challenge.id}`)
    }
    ids.add(challenge.id)
  }
  return value
}

function validateFamilies(value) {
  if (value?.schema !== 'owasp-ptk-playground-families/v1' || !Array.isArray(value.families)) {
    throw new Error('invalid_family_catalog')
  }
  return value
}

function validatePlaylists(value) {
  if (value?.schema !== 'owasp-ptk-playground-playlists/v1' || !Array.isArray(value.playlists)) {
    throw new Error('invalid_playlist_catalog')
  }
  return value
}

async function loadJson(url, validator) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error(`catalog_http_${response.status}`)
  return validator(await response.json())
}

function routeAwareStatus() {
  const port = Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 80))
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return null
  if (![3080, 3443].includes(port)) return null
  return { httpPort: 3080, httpsPort: 3443 }
}

function targetUrl(target) {
  if (!target.runtime || target.runtime.kind !== 'route-aware-server') {
    return new URL(target.route.replace(/^\.\//, ''), rootUrl).href
  }
  const runtime = routeAwareStatus()
  if (!runtime) return null
  const protocol = target.runtime.protocol === 'https' ? 'https' : 'http'
  const port = Number(target.runtime.port || runtime[`${protocol}Port`])
  const pathname = new URL(target.route.replace(/^\.\//, '/'), 'http://playground.test').pathname
  return new URL(pathname, `${protocol}://${window.location.hostname}:${port}`).href
}

function targetAction(target, label, kind = 'primary') {
  const url = targetUrl(target)
  if (!url) {
    return element('a', {
      className: 'button button--secondary',
      text: 'Run locally for DAST',
      attributes: { href: 'https://github.com/ptklabs/ptk-playground#run-the-complete-local-demo-with-docker' }
    })
  }
  return element('a', {
    className: kind === 'primary' ? 'button' : 'button button--secondary',
    text: label,
    attributes: { href: url }
  })
}

function kindLabel(challenge) {
  if (challenge.kind === 'atomic-challenge') return 'Paired challenge'
  if (challenge.kind === 'atomic-observation') return 'Focused observation'
  return 'Advanced lab'
}

function challengeCard(challenge, options = {}) {
  const card = element('article', {
    className: `challenge-card challenge-card--${challenge.kind}`,
    attributes: { 'data-challenge-id': challenge.id }
  })
  if (options.number) card.append(element('span', { className: 'challenge-card__number', text: options.number }))
  const heading = element('div', { className: 'challenge-card__heading' })
  const headingText = element('div', { className: 'challenge-card__heading-copy' })
  headingText.append(element('p', { className: 'eyebrow', text: challenge.category }))
  headingText.append(element('h2', { text: challenge.title }))
  heading.append(headingText)
  heading.append(badge(kindLabel(challenge), challenge.kind === 'advanced-lab' ? 'mixed' : 'primary'))
  card.append(heading)
  card.append(element('p', { text: challenge.summary }))

  const engines = element('div', { className: 'badge-row' })
  for (const engine of challenge.engines) engines.append(badge(engine, engine === 'IAST' || engine === 'SCA' ? 'primary' : 'default'))
  if (challenge.migrationStatus.startsWith('pending')) engines.append(badge('Migration pending', 'mixed'))
  card.append(engines)

  if (challenge.productPreview) {
    const preview = element('p', { className: 'challenge-card__preview' })
    preview.append(element('strong', { text: `${challenge.productPreview.label} — Coming soon. ` }))
    preview.append(document.createTextNode(challenge.productPreview.summary))
    card.append(preview)
  }

  const actions = element('div', { className: 'challenge-card__actions' })
  if (options.guided && challenge.guidance?.route) {
    actions.append(element('a', {
      className: 'button',
      text: 'Start guided mission',
      attributes: { href: new URL(challenge.guidance.route.replace(/^\.\//, ''), rootUrl).href }
    }))
  }
  actions.append(targetAction(challenge.targets.review, challenge.targets.repaired ? 'Open review target' : 'Open lab'))
  if (challenge.targets.repaired) actions.append(targetAction(challenge.targets.repaired, 'Open repaired control', 'secondary'))
  card.append(actions)

  if (challenge.kind === 'advanced-lab') {
    const children = challenge.provenance?.derivedChallengeIds || []
    card.append(element('p', {
      className: 'challenge-card__note',
      text: children.length
        ? `${children.length} focused challenge${children.length === 1 ? '' : 's'} preserve the reviewed assertions from this historical page.`
        : 'This historical page is preserved as a compatibility lab; its reviewed content does not declare a separate atomic assertion.'
    }))
    if (children.length && challenge.provenance.sourceIds?.[0]) {
      actions.append(element('a', {
        className: 'button button--secondary',
        text: `Explore ${children.length} focused case${children.length === 1 ? '' : 's'}`,
        attributes: {
          href: new URL(`explore/?source=${encodeURIComponent(challenge.provenance.sourceIds[0])}`, rootUrl).href
        }
      }))
    }
  }
  return card
}

function exploreFilters() {
  return {
    search: document.querySelector('[data-explore-search]')?.value.trim().toLowerCase() || '',
    engine: document.querySelector('[data-explore-engine]')?.value || '',
    kind: document.querySelector('[data-explore-kind]')?.value || '',
    status: document.querySelector('[data-explore-status]')?.value || '',
    source: exploreSourceId
  }
}

function matchesExplore(challenge, filters) {
  if (filters.engine && !challenge.engines.includes(filters.engine)) return false
  if (filters.kind && challenge.kind !== filters.kind) return false
  if (filters.status === 'paired' && !challenge.targets.repaired) return false
  if (filters.status === 'compatibility' && challenge.kind !== 'advanced-lab') return false
  if (filters.status === 'automation' && !challenge.suitability.automation) return false
  if (filters.source && (
    challenge.kind === 'advanced-lab' ||
    !(challenge.provenance?.sourceIds || []).includes(filters.source)
  )) return false
  if (!filters.search) return true
  return [
    challenge.id,
    challenge.title,
    challenge.summary,
    challenge.category,
    challenge.targets.review.route,
    ...challenge.engines
  ].join(' ').toLowerCase().includes(filters.search)
}

function renderExplore(resetLimit = false) {
  const container = document.querySelector('[data-explore-results]')
  if (!container) return
  if (resetLimit) exploreVisibleLimit = explorePageSize
  const filters = exploreFilters()
  const matching = challengeCatalog.challenges.filter((challenge) => matchesExplore(challenge, filters))
  const visible = matching.slice(0, exploreVisibleLimit)
  container.replaceChildren()
  if (!matching.length) {
    container.append(element('p', { className: 'empty-state', text: 'No challenges match these filters.' }))
  } else {
    for (const challenge of visible) container.append(challengeCard(challenge))
  }
  const summary = document.querySelector('[data-explore-summary]')
  if (summary) {
    const scope = filters.source ? ' · focused children of one historical source' : ''
    summary.textContent = `${visible.length} shown · ${matching.length} matching · ${challengeCatalog.challenges.length} total${scope}`
  }
  const more = document.querySelector('[data-explore-more]')
  if (more) {
    more.hidden = visible.length >= matching.length
    more.textContent = `Show ${Math.min(explorePageSize, matching.length - visible.length)} more`
  }
}

function bindExplore() {
  const params = new URL(window.location.href).searchParams
  const requested = {
    engine: params.get('engine'),
    kind: params.get('kind'),
    status: params.get('status'),
    search: params.get('search')
  }
  exploreSourceId = params.get('source') || ''
  const clearSource = document.querySelector('[data-explore-source-clear]')
  if (clearSource) clearSource.hidden = !exploreSourceId
  const controls = {
    engine: document.querySelector('[data-explore-engine]'),
    kind: document.querySelector('[data-explore-kind]'),
    status: document.querySelector('[data-explore-status]'),
    search: document.querySelector('[data-explore-search]')
  }
  for (const [name, value] of Object.entries(requested)) {
    if (!value || !controls[name]) continue
    if (name === 'search' || Array.from(controls[name].options || []).some((option) => option.value === value)) controls[name].value = value
  }
  for (const control of document.querySelectorAll('[data-explore-search], [data-explore-engine], [data-explore-kind], [data-explore-status]')) {
    control.addEventListener(control.matches('input') ? 'input' : 'change', () => renderExplore(true))
  }
  document.querySelector('[data-explore-more]')?.addEventListener('click', () => {
    exploreVisibleLimit += explorePageSize
    renderExplore()
  })
  renderExplore()
}

function selectedPlaylist() {
  const requested = new URL(window.location.href).searchParams.get('playlist')
  return playlistCatalog.playlists.find((playlist) => playlist.id === requested) || playlistCatalog.playlists[0]
}

function renderPlay() {
  const navigation = document.querySelector('[data-playlist-list]')
  const container = document.querySelector('[data-playlist-challenges]')
  if (!navigation || !container) return
  const playlist = selectedPlaylist()
  const challengeById = new Map(challengeCatalog.challenges.map((challenge) => [challenge.id, challenge]))

  navigation.replaceChildren()
  for (const option of playlistCatalog.playlists) {
    const link = element('a', {
      className: option.id === playlist.id ? 'playlist-option playlist-option--active' : 'playlist-option',
      text: option.title,
      attributes: {
        href: `?playlist=${encodeURIComponent(option.id)}`,
        'aria-current': option.id === playlist.id ? 'page' : null
      }
    })
    navigation.append(link)
  }

  document.querySelector('[data-playlist-title]').textContent = playlist.title
  document.querySelector('[data-playlist-summary]').textContent = playlist.summary
  const duration = document.querySelector('[data-playlist-duration]')
  duration.textContent = playlist.durationMinutes ? `${playlist.durationMinutes} minutes` : `${playlist.challengeIds.length} challenges`

  container.replaceChildren()
  playlist.challengeIds.forEach((challengeId, index) => {
    const challenge = challengeById.get(challengeId)
    if (challenge) container.append(challengeCard(challenge, { number: index + 1, guided: true }))
  })
}

function renderCorpusStats() {
  const fields = {
    challenges: challengeCatalog.summary.challenges,
    atomic: challengeCatalog.summary.atomic + challengeCatalog.summary.atomicObservations,
    atomicSast: challengeCatalog.summary.generatedAtomicSast,
    atomicIast: challengeCatalog.summary.generatedAtomicIast,
    advanced: challengeCatalog.summary.advancedLabs,
    sources: challengeCatalog.summary.authoredSourceFiles,
    retained: challengeCatalog.summary.retainedAggregateAssertions,
    pending: challengeCatalog.summary.pendingScenarioReview,
    scenarios: challengeCatalog.summary.classifiedScenarioMarkers,
    dast: challengeCatalog.summary.dastRuntimeTargets,
    sca: challengeCatalog.summary.scaScenarios
  }
  for (const [name, value] of Object.entries(fields)) {
    for (const node of document.querySelectorAll(`[data-corpus-count="${name}"]`)) node.textContent = String(value)
  }
}

function showError(error) {
  for (const container of document.querySelectorAll('[data-explore-results], [data-playlist-challenges]')) {
    container.replaceChildren(element('p', {
      className: 'empty-state',
      text: 'The canonical playground catalogue could not be loaded. Existing direct fixture routes remain available.'
    }))
  }
  document.documentElement.dataset.catalogStatus = 'error'
  console.error('[ptk-playground] canonical catalogue load failed', error)
}

async function init() {
  try {
    [challengeCatalog, familyCatalog, playlistCatalog] = await Promise.all([
      loadJson(challengesUrl, validateChallenges),
      loadJson(familiesUrl, validateFamilies),
      loadJson(playlistsUrl, validatePlaylists)
    ])
    void familyCatalog
    renderCorpusStats()
    if (document.body.dataset.page === 'explore') bindExplore()
    if (document.body.dataset.page === 'play') renderPlay()
    document.documentElement.dataset.catalogStatus = 'ready'
  } catch (error) {
    showError(error)
  }
}

init()
