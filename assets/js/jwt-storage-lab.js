const signedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdGstcGxheWdyb3VuZCIsInNjb3BlIjoiZGVtbyJ9.synthetic-signature'
const variant = document.body.dataset.jwtStorageVariant === 'vulnerable' ? 'vulnerable' : 'fixed'

function clearValues() {
  document.cookie = 'ptk_playground_jwt=; Max-Age=0; Path=/; SameSite=Lax'
  localStorage.removeItem('ptk_playground_access_token')
  sessionStorage.removeItem('ptk_playground_id_token')
}

function seedValues() {
  clearValues()
  const value = variant === 'vulnerable' ? signedToken : 'opaque-session-reference'
  document.cookie = `ptk_playground_jwt=${value}; Path=/; SameSite=Lax`
  localStorage.setItem('ptk_playground_access_token', value)
  sessionStorage.setItem('ptk_playground_id_token', value)
  render()
}

function render() {
  const label = variant === 'vulnerable' ? 'Synthetic JWT present' : 'Opaque non-JWT value present'
  for (const node of document.querySelectorAll('[data-jwt-state]')) node.textContent = label
}

document.querySelector('[data-jwt-action="seed"]')?.addEventListener('click', seedValues)
document.querySelector('[data-jwt-action="clear"]')?.addEventListener('click', () => {
  clearValues()
  for (const node of document.querySelectorAll('[data-jwt-state]')) node.textContent = 'Value cleared'
})
seedValues()
