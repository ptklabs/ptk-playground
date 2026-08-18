const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "ptk-runtime-evidence"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    await fetch(new URL(location.pathname + '?ptk=' + encodeURIComponent(input.value), location.href).href, { method: 'POST', body: input.value });
    evidence.textContent = 'Value sent in request body';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
