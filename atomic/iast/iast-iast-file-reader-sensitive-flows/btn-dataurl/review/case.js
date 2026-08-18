const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "ptk-runtime-evidence"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const file = new File([input.value], 'evidence.txt', { type: 'text/plain' });
    const reader = new FileReader();
    reader.addEventListener('load', () => { output.innerHTML = String(reader.result); evidence.textContent = 'FileReader result rendered'; });
    reader.readAsDataURL(file);
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
