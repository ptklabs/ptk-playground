const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "ptk-runtime-evidence"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const request = new XMLHttpRequest();
    request.open('GET', new URL(location.pathname + '?ptk=' + encodeURIComponent(input.value), location.href).href);
    request.setRequestHeader('X-PTK-Value', input.value);
    request.send();
    evidence.textContent = 'Value sent through XHR';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
