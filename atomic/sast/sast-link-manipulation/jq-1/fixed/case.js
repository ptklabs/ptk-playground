const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "#ptk-atomic-evidence"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const destination = new URL(input.value, location.href);
    const link = document.querySelector('#case-link');
    link.href = destination.origin === location.origin ? destination.pathname + destination.hash : '#rejected';
    evidence.textContent = destination.origin === location.origin ? 'Same-origin target accepted' : 'External target rejected';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
