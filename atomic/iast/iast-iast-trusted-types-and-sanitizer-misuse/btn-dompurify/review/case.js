const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "<strong data-ptk-evidence=\"runtime\">PTK runtime evidence</strong>"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const DOMPurify = { sanitize: (candidate) => candidate };
    output.innerHTML = DOMPurify.sanitize(input.value, { ALLOW_UNKNOWN_PROTOCOLS: true });
    evidence.textContent = 'Permissive sanitizer result reached HTML sink';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
