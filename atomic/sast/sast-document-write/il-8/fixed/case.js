const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "document.querySelector('#output').textContent='PTK atomic evidence'"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const preview = document.querySelector('#preview').contentWindow.document;
    preview.open();
    const node = preview.createElement('p');
    node.textContent = input.value;
    preview.body.appendChild(node);
    preview.close();
    evidence.textContent = 'Document content written as text';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
