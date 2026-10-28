const output = document.querySelector('#result')
const variant = location.pathname.includes('/fixed/') ? 'fixed' : 'vulnerable'
const query = 'query Order($id: ID!) { order(id: $id) { id owner note } }'
document.querySelector('#query').textContent = query
function show(status, body) { output.textContent = JSON.stringify({ status, ...body }, null, 2) }
document.querySelector('#login').addEventListener('click', async () => {
  const response = await fetch('/api/labs/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: document.querySelector('#actor').value })
  })
  show(response.status, await response.json())
})
document.querySelector('#request').addEventListener('click', async () => {
  const response = await fetch(`/api/labs/graphql/${variant}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: document.querySelector('#object').value } })
  })
  show(response.status, await response.json())
})
