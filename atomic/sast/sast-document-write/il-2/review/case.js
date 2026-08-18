const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "<strong data-ptk-evidence='atomic'>PTK atomic evidence</strong>"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const preview = document.querySelector('#preview').contentWindow.document;
    preview.open();
    preview.write(decodeURIComponent(location.hash.slice(1)) || input.value);
    preview.close();
    evidence.textContent = 'Document stream written';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
