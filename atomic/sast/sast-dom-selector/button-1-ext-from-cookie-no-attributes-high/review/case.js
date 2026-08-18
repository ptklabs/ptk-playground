const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "#output"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    document.querySelector((document.cookie.match(/(?:^|;\s*)ptk_atomic_source=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)ptk_atomic_source=([^;]*)/)[1]) : input.value));
    evidence.textContent = 'Selector evaluated';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
