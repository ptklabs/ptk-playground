const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "{\"name\":\"PTK runtime evidence\",\"__proto__\":{\"ptk\":true}}"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const parsed = JSON.parse(input.value);
    Reflect.set({}, '__proto__', parsed.__proto__);
    evidence.textContent = 'Untrusted prototype value reached Reflect.set';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
