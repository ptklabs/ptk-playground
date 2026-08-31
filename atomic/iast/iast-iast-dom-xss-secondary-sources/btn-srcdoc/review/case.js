const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "<strong data-ptk-evidence=\"runtime\">PTK runtime evidence</strong>"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    localStorage.setItem('ptkAtomicSecondaryHtml', input.value);
    const secondaryValue = localStorage.getItem('ptkAtomicSecondaryHtml');
    document.querySelector('#preview').srcdoc = secondaryValue;
    evidence.textContent = 'localStorage value reached iframe.srcdoc';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
