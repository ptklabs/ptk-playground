const signedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdGstcGxheWdyb3VuZCIsInNjb3BlIjoiZGVtbyJ9.synthetic-signature'

async function sendCarrier(carrier, variant) {
  const base = `../${carrier}/${variant}/api`
  const headers = { 'X-Playground-Request': 'jwt-lab' }
  const options = { method: 'POST', headers, credentials: 'same-origin' }
  if (carrier === 'authorization') headers.Authorization = `Bearer ${signedToken}`
  if (carrier === 'cookie') {
    await fetch(`${base}/seed`, { credentials: 'same-origin', headers })
  }
  if (carrier === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    options.body = new URLSearchParams({ access_token: signedToken, keep: 'unchanged' })
  }
  if (carrier === 'json') {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify({ auth: { access_token: signedToken }, keep: 'unchanged' })
  }
  const response = await fetch(`${base}/session`, options)
  const body = await response.json()
  return `${variant}: HTTP ${response.status} · ${body.code || body.message || 'response received'}`
}

for (const button of document.querySelectorAll('[data-jwt-carrier][data-jwt-variant]')) {
  button.addEventListener('click', async () => {
    const carrier = button.dataset.jwtCarrier
    const output = document.querySelector(`[data-jwt-result="${carrier}"]`)
    button.disabled = true
    if (output) output.textContent = 'Sending…'
    try {
      if (output) output.textContent = await sendCarrier(carrier, button.dataset.jwtVariant)
    } catch (error) {
      if (output) output.textContent = `Runtime unavailable: ${error instanceof Error ? error.message : 'request failed'}`
    } finally {
      button.disabled = false
    }
  })
}
