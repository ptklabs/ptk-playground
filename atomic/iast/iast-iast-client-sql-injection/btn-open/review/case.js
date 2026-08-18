const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "{\"name\":\"PTK runtime evidence\",\"__proto__\":{\"ptk\":true}}"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const databaseName = input.value;
    if (typeof openDatabase === 'function') openDatabase(databaseName, '1.0', 'PTK', 1024);
    evidence.textContent = 'Value used by Web SQL';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
