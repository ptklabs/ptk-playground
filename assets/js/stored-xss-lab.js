const output = document.querySelector('#result')
const preview = document.querySelector('#preview')
function show(value) { output.textContent = JSON.stringify(value, null, 2) }
document.querySelector('#login').addEventListener('click', async () => {
  const response = await fetch('/api/labs/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: document.querySelector('#actor').value }) })
  show({ status: response.status, ...await response.json() })
})
document.querySelector('#save').addEventListener('click', async () => {
  const response = await fetch('/api/labs/stored-xss/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: document.querySelector('#message').value }) })
  show({ status: response.status, ...await response.json() })
})
document.querySelector('#load').addEventListener('click', async () => {
  const response = await fetch('/api/labs/stored-xss/messages')
  const data = await response.json()
  show({ status: response.status, ...data })
  if (!response.ok) return
  window.renderSavedMessage(preview, data.message)
})
