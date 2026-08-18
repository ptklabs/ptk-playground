const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ."

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const token = input.value;
    output.textContent = token ? 'Token present; authorization remains server-side' : 'No token';
    evidence.textContent = 'Client claim not trusted';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
