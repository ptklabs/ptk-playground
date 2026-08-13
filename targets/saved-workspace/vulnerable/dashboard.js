const STORAGE_KEY = 'ptk_saved_workspace_announcement_review'
const preview = document.getElementById('announcement-preview')
const status = document.getElementById('announcement-status')
const savedAnnouncement = localStorage.getItem(STORAGE_KEY) || 'No saved announcement.'

preview.innerHTML = savedAnnouncement
status.textContent = preview.querySelector('[data-workspace-marker]')
  ? 'SAVED-WORKSPACE-MARKUP-RENDERED'
  : 'Saved announcement displayed'

document.getElementById('clear-announcement')?.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY)
  window.location.replace('./')
})
