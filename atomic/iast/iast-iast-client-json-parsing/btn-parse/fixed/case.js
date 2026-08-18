const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "{\"name\":\"PTK runtime evidence\",\"__proto__\":{\"ptk\":true}}"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const parsed = JSON.parse(input.value);
    const clean = Object.create(null);
    for (const key of Object.keys(parsed)) if (!['__proto__', 'constructor', 'prototype'].includes(key)) clean[key] = parsed[key];
    output.textContent = JSON.stringify(clean);
    evidence.textContent = 'Parsed object copied through an own-key allow-list';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
