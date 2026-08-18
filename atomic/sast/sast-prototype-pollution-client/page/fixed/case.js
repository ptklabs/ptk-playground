const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "{\"name\":\"PTK evidence\",\"__proto__\":{\"ptk\":true}}"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const parsed = JSON.parse(input.value);
    const result = Object.create(null);
    for (const key of Object.keys(parsed)) if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') result[key] = parsed[key];
    evidence.textContent = 'Dangerous object keys rejected';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
