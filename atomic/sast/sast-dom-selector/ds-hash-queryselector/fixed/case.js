const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "#output"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const allowed = new Set(['#output', '#evidence']);
    const selector = allowed.has(decodeURIComponent(location.hash.slice(1)) || input.value) ? decodeURIComponent(location.hash.slice(1)) || input.value : '#output';
    document.querySelector(selector);
    evidence.textContent = 'Allow-listed selector used';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
