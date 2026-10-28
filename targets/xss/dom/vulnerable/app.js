const proof = `<img src="/targets/xss/dom/missing.png" onerror="document.documentElement.dataset.ptkXss='executed';document.getElementById('proof-status').textContent='executed'">`
document.getElementById('proof-link').href = `#message=${encodeURIComponent(proof)}`

function renderFragment() {
  const message = new URLSearchParams(location.hash.slice(1)).get('message') || ''
  document.getElementById('preview').innerHTML = message.slice(0, 240)
}

window.addEventListener('hashchange', renderFragment)
renderFragment()
