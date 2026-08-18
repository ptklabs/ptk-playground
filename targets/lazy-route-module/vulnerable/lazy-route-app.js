const workspace = document.getElementById('analytics-route-workspace')
const status = document.getElementById('analytics-route-status')
const preparedSummary = '<strong data-lazy-route-proof="true">Quarterly analytics ready</strong>'

async function renderRoute() {
  const query = new URLSearchParams(window.location.search)
  if (query.get('view') !== 'analytics') {
    workspace.textContent = 'The analytics route is closed.'
    status.textContent = 'LAZY-ROUTE-IDLE'
    return
  }
  status.textContent = 'Importing the analytics route…'
  const route = await import('./analytics-route.js')
  await route.renderAnalyticsRoute({ workspace, status })
}

document.getElementById('open-analytics-route').addEventListener('click', () => {
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: 'analytics', summary: preparedSummary }).toString()
  history.pushState({ view: 'analytics' }, '', url)
  renderRoute()
})

document.getElementById('reset-analytics-route').addEventListener('click', () => {
  history.pushState({ view: 'home' }, '', window.location.pathname)
  renderRoute()
})

window.addEventListener('popstate', renderRoute)
renderRoute()
