const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "<strong data-ptk-evidence=\"runtime\">PTK runtime evidence</strong>"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const response = await fetch('./payload.json').then((result) => result.json());
    const sourceValue = response.html;
    const mime = document.querySelector('#parser-mime')?.value || 'text/html';
    const cleanMarkup = mime === 'image/svg+xml' ? '<svg><text>Known safe markup</text></svg>' : '<p>Known safe markup</p>';
    new DOMParser().parseFromString(cleanMarkup, mime);
    output.textContent = sourceValue;
    evidence.textContent = 'Same parser invoked with constant markup; untrusted value stayed text';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
