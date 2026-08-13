const preview = document.getElementById('profile-preview')
const status = document.getElementById('profile-status')

async function loadProfile() {
  status.textContent = 'PROFILE-PREVIEW-LOADING'
  const response = await fetch('../profile.json', {
    cache: 'no-store',
    credentials: 'omit'
  })
  if (!response.ok) throw new Error(`profile_http_${response.status}`)
  const profile = await response.json()
  await new Promise((resolve) => setTimeout(resolve, 250))
  preview.innerHTML = profile.summaryHtml
  status.textContent = preview.querySelector('[data-profile-proof]')
    ? 'PROFILE-RESPONSE-MARKUP-RENDERED'
    : 'PROFILE-PREVIEW-INCOMPLETE'
}

document.getElementById('load-profile').addEventListener('click', () => {
  loadProfile().catch((error) => {
    preview.textContent = 'Profile preview could not be loaded.'
    status.textContent = `PROFILE-PREVIEW-ERROR:${error.message}`
  })
})

document.getElementById('reset-profile').addEventListener('click', () => {
  preview.textContent = 'Profile preview is closed.'
  status.textContent = 'PROFILE-PREVIEW-IDLE'
})
