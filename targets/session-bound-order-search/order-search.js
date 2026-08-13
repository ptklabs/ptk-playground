const form = document.getElementById('order-search-form')
const queryInput = document.getElementById('order-query')
const diagnosticButton = document.getElementById('prepared-diagnostic')
const result = document.getElementById('order-search-result')
const endpoint = new URL('./api/search', window.location.href).href

async function searchOrders(query, diagnostic = false) {
  result.textContent = 'Searching the current account…'
  result.removeAttribute('data-result')
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Playground-Request': 'order-search'
      },
      body: new URLSearchParams({ query }).toString()
    })
    const payload = await response.json()
    if (payload.code === 'ORDER_QUERY_SYNTAX') {
      result.textContent = 'ORDER-SEARCH-DATABASE-ERROR'
      result.dataset.result = 'review'
      return
    }
    if (!response.ok || payload.ok !== true) throw new Error(payload.code || `response_${response.status}`)
    result.textContent = diagnostic
      ? 'ORDER-SEARCH-SAFE'
      : payload.message
    result.dataset.result = diagnostic ? 'repaired' : 'normal'
  } catch {
    result.textContent = 'The order search could not be completed in this session.'
    result.dataset.result = 'error'
  }
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  searchOrders(String(queryInput.value || ''))
})

diagnosticButton?.addEventListener('click', () => {
  searchOrders("wireless headphones'", true)
})
