const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "document.querySelector('#output').textContent='PTK runtime evidence'"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const blob = new Blob([input.value], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = objectUrl;
    document.head.appendChild(script);
    evidence.textContent = 'Blob URL reached script.src';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
