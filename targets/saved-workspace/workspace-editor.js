const form = document.getElementById('workspace-form')
const announcement = document.getElementById('workspace-announcement')
const storageKey = document.body.dataset.storageKey

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  localStorage.setItem(storageKey, announcement.value)
  window.location.assign(new URL('./dashboard.html', window.location.href).href)
})

document.getElementById('clear-workspace')?.addEventListener('click', () => {
  localStorage.removeItem(storageKey)
  announcement.value = announcement.defaultValue
})
