const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = new URLSearchParams(location.search).get('value') || "<strong data-ptk-evidence=\"runtime\">PTK runtime evidence</strong>"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    document.querySelector('#preview').srcdoc = '<p data-ptk-control="constant">Known safe markup</p>';
    output.textContent = input.value;
    evidence.textContent = 'Same iframe sink invoked with constant markup; untrusted value stayed text';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
