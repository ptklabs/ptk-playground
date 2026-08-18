const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "ptk-runtime-evidence"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const cache = await caches.open('ptk-atomic');
    await cache.put('./atomic-value', new Response(input.value));
    const stored = await cache.match('./atomic-value');
    await fetch(new URL(location.pathname + '?ptk=' + encodeURIComponent(input.value), location.href).href + '&stored=' + encodeURIComponent(await stored.text()));
    evidence.textContent = 'Cached value reused in request';
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
