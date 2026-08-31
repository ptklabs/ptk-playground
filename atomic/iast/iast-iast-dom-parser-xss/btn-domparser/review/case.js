const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = new URLSearchParams(location.search).get('value') || "<strong data-ptk-evidence=\"runtime\">PTK runtime evidence</strong>"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const mime = document.querySelector('#parser-mime')?.value || 'text/html';
    const parsed = new DOMParser().parseFromString(input.value, mime);
    output.replaceChildren(document.importNode(parsed.documentElement, true));
    evidence.textContent = 'DOMParser result appended for ' + mime;
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
