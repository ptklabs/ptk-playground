const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "<strong data-ptk-evidence='atomic'>PTK atomic evidence</strong>"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || typeof event.data !== 'string') return;
      output.textContent = event.data;
      evidence.textContent = 'Validated message displayed as text';
    }, { once: true });
    window.postMessage((document.cookie.match(/(?:^|;\s*)ptk_atomic_source=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)ptk_atomic_source=([^;]*)/)[1]) : input.value), location.origin);
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
