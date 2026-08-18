const view = document.getElementById('order-route-view')
const routeStatus = document.getElementById('order-route-status')
const apiStatus = document.getElementById('order-api-status')
const preparedOrderId = 'order-4815'
const preparedOrderLabel = '<mark data-history-order-proof="true">Order 4815</mark>'

function currentRoute() {
  const query = new URLSearchParams(window.location.search)
  return {
    orderId: query.get('order'),
    label: query.get('label')
  }
}

async function requestOrder(orderId) {
  apiStatus.textContent = 'Requesting the order with this browser session…'
  try {
    const response = await fetch('./api/order', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Playground-Request': 'history-order-router'
      },
      body: JSON.stringify({ orderId })
    })
    if (!response.ok) {
      apiStatus.textContent = 'Route rendered; start the local demo runtime for authenticated API evidence.'
      return
    }
    const result = await response.json()
    apiStatus.textContent = result.message
  } catch {
    apiStatus.textContent = 'Route rendered; start the local demo runtime for authenticated API evidence.'
  }
}

function renderRoute({ request = false } = {}) {
  const route = currentRoute()
  if (route.orderId === null) {
    view.textContent = 'No order route is open.'
    routeStatus.textContent = 'HISTORY-ORDER-IDLE'
    apiStatus.textContent = 'No order request has been sent.'
    return
  }

  view.innerHTML = route.label || 'No order label was supplied.'
  routeStatus.textContent = view.querySelector('[data-history-order-proof]')
    ? 'HISTORY-ORDER-ROUTE-MARKUP'
    : 'HISTORY-ORDER-ROUTE-UPDATED'
  if (request) requestOrder(route.orderId)
}

document.getElementById('open-order-route').addEventListener('click', () => {
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: 'order', order: preparedOrderId, label: preparedOrderLabel }).toString()
  history.pushState({ view: 'order' }, '', url)
  renderRoute({ request: true })
})

document.getElementById('previous-route').addEventListener('click', () => history.back())
window.addEventListener('popstate', () => renderRoute())
renderRoute()
