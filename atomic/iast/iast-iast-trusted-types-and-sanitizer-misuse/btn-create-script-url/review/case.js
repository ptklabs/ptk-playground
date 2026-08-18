const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "document.querySelector('#output').textContent='PTK runtime evidence'"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const policy = trustedTypes.createPolicy('ptk-url-' + Date.now(), { createScriptURL: (candidate) => candidate });
    const script = document.createElement('script');
    script.src = policy.createScriptURL(input.value);
    document.head.appendChild(script);
    evidence.textContent = 'Value reached TrustedScriptURL policy';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
