const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ."

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const payload = JSON.parse(atob(input.value.split('.')[1]));
    output.textContent = payload.role || 'No role';
    evidence.textContent = 'Unsigned client claim trusted';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
