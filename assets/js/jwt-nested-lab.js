const output = document.querySelector('#result')
const tokenInput = document.querySelector('#token')
const variant = document.querySelector('#variant')
function show(value) { output.textContent = JSON.stringify(value, null, 2) }
document.querySelector('#issue').addEventListener('click', async () => {
  const response = await fetch(`/api/labs/jwt/nested/${variant.value}/issue`)
  const data = await response.json()
  tokenInput.value = data.token || ''
  show({ status: response.status, code: data.code })
})
document.querySelector('#send').addEventListener('click', async () => {
  const response = await fetch(`/api/labs/jwt/nested/${variant.value}/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auth: { access_token: tokenInput.value } }) })
  show({ status: response.status, ...await response.json() })
})
