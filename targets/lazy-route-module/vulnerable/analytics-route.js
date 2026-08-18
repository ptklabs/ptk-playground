const dependencyUrl = new URL('../../../assets/vendor/jquery/jquery-3.4.1.min.js', import.meta.url)

function loadDependency() {
  return new Promise((resolve, reject) => {
    if (window.jQuery?.fn?.jquery === '3.4.1') {
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
  workspace.innerHTML = routeState.get('summary') || 'No analytics summary was supplied.'
  window.jQuery(workspace).attr('data-dependency-version', window.jQuery.fn.jquery)
  status.textContent = workspace.querySelector('[data-lazy-route-proof]')
    ? 'LAZY-ROUTE-MODULE-AND-DEPENDENCY-LOADED'
    : 'LAZY-ROUTE-MODULE-LOADED'
}
