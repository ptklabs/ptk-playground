const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "document.querySelector('#output').textContent='PTK atomic evidence'"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    eval(input.value);
    evidence.textContent = 'Value evaluated';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
