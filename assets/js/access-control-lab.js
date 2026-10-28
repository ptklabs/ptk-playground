const match = location.pathname.match(/idor-(read|write)\/(vulnerable|fixed)/)
const kind = match?.[1]
const variant = match?.[2]
const output = document.querySelector('#result')
const actor = document.querySelector('#actor')
const object = document.querySelector('#object')
function show(value) { output.textContent = JSON.stringify(value, null, 2) }
document.querySelector('#login').addEventListener('click', async () => {
  const response = await fetch('/api/labs/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: actor.value }) })
  show({ status: response.status, ...await response.json() })
})
document.querySelector('#request').addEventListener('click', async () => {
  const options = kind === 'write' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: document.querySelector('#note').value }) } : {}
  const response = await fetch(`/api/labs/idor-${kind}/${variant}/objects/${object.value}`, options)
  show({ status: response.status, ...await response.json() })
})
