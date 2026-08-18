const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')

input.value = "document.querySelector('#output').textContent='PTK runtime evidence'"

document.querySelector('#run-case').addEventListener('click', async () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const request = indexedDB.open('ptk-atomic', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onsuccess = () => { const tx = request.result.transaction('values', 'readwrite'); const store = tx.objectStore('values'); store.put(input.value, 'value'); tx.oncomplete = () => { const readTx = request.result.transaction('values'); const readRequest = readTx.objectStore('values').get('value'); readRequest.onsuccess = () => eval(String(readRequest.result)); }; evidence.textContent = 'IndexedDB value queued for eval'; };
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
