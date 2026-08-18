const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "document.querySelector('#output').textContent='PTK atomic evidence'"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    if (typeof crypto.generateCRMFRequest === 'function') crypto.generateCRMFRequest(decodeURIComponent(location.hash.slice(1)) || input.value); else throw new Error('CRMF API unavailable');
    evidence.textContent = 'CRMF generation boundary reached';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
