const STORAGE_KEY = 'ptk_saved_workspace_announcement_control'
const preview = document.getElementById('announcement-preview')
const status = document.getElementById('announcement-status')
const savedAnnouncement = localStorage.getItem(STORAGE_KEY) || 'No saved announcement.'

preview.textContent = savedAnnouncement
status.textContent = 'SAVED-WORKSPACE-TEXT-SAFE'

document.getElementById('clear-announcement')?.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY)
  window.location.replace('./')
})
