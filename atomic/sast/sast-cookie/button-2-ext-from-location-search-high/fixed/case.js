const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "ptk_atomic_source=PTK-evidence; SameSite=Strict"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    document.cookie = 'ptk_atomic_value=' + encodeURIComponent(new URLSearchParams(location.search).get('value') || input.value) + '; SameSite=Strict';
    evidence.textContent = 'Cookie value encoded';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
