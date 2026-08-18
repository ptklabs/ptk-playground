const dependencyUrl = new URL('../../../assets/vendor/jquery/jquery-3.7.1.min.js', import.meta.url)
const reviewedSummaries = new Map([['quarterly-ready', 'Quarterly analytics ready']])

function loadDependency() {
  return new Promise((resolve, reject) => {
    if (window.jQuery?.fn?.jquery === '3.7.1') {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = dependencyUrl.href
    script.addEventListener('load', resolve, { once: true })
    script.addEventListener('error', reject, { once: true })
    document.head.append(script)
  })
}

export async function renderAnalyticsRoute({ workspace, status }) {
  await loadDependency()
  const routeState = new URLSearchParams(window.location.search)
  const summary = reviewedSummaries.get(routeState.get('summary'))
  workspace.textContent = summary || 'Unknown analytics route rejected.'
  window.jQuery(workspace).attr('data-dependency-version', window.jQuery.fn.jquery)
  status.textContent = summary
    ? 'LAZY-ROUTE-MODULE-TEXT-SAFE'
    : 'LAZY-ROUTE-MODULE-REJECTED'
}
