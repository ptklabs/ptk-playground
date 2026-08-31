const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = new URLSearchParams(location.search).get('value') || "ptk-runtime-evidence"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    document.querySelector('#preview').src = new URL(location.pathname + '?ptk=' + encodeURIComponent(input.value), location.href).href;
    evidence.textContent = 'Value reached iframe.src';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
