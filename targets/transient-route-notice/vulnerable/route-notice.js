const notice = document.getElementById('route-notice')
const status = document.getElementById('route-status')
const preparedNotice = '<mark data-route-proof="true">Priority incident update</mark>'
let expiryTimer = null

function readRouteNotice() {
  const query = (window.location.hash.split('?')[1] || '')
  return new URLSearchParams(query).get('notice')
}

function expireNotice() {
  window.clearTimeout(expiryTimer)
  expiryTimer = window.setTimeout(() => {
    notice.replaceChildren()
    notice.textContent = 'The route notice expired.'
  }, 30)
}

function renderRouteNotice() {
  const routeNotice = readRouteNotice()
  if (routeNotice === null) {
    window.clearTimeout(expiryTimer)
    notice.textContent = 'No route notice is open.'
    status.textContent = 'ROUTE-NOTICE-IDLE'
    return
  }

  notice.innerHTML = routeNotice
  status.textContent = notice.querySelector('[data-route-proof]')
    ? 'ROUTE-NOTICE-TRANSIENT-MARKUP'
    : 'ROUTE-NOTICE-ROUTE-UPDATED'
  expireNotice()
}

document.getElementById('open-route-notice').addEventListener('click', () => {
  window.location.hash = `#/incidents?notice=${encodeURIComponent(preparedNotice)}`
})

document.getElementById('reset-route-notice').addEventListener('click', () => {
  history.replaceState(null, '', window.location.pathname)
  renderRouteNotice()
})

window.addEventListener('hashchange', renderRouteNotice)
renderRouteNotice()
