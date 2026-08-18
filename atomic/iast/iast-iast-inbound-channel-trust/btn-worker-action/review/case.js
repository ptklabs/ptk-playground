const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "document.querySelector('#output').textContent='PTK runtime evidence'"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const workerUrl = URL.createObjectURL(new Blob(["onmessage = (event) => postMessage(event.data)"], { type: 'application/javascript' }));
    const worker = new Worker(workerUrl);
    worker.onmessage = (event) => { document.querySelector('#case-form').action = new URL('#' + encodeURIComponent(event.data), location.href).href; worker.terminate(); };
    worker.postMessage(input.value);
    evidence.textContent = 'Worker message reached form.action';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
