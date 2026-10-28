const proof = '";marker();//'
const input = new URLSearchParams(location.search).get('message') || ''
const marker = () => {
  document.documentElement.dataset.ptkXss = 'executed'
  document.getElementById('proof-status').textContent = 'executed'
}
document.getElementById('proof-link').href = `?message=${encodeURIComponent(proof)}`
document.getElementById('compare-link').href = `/targets/xss/query-code/fixed/?message=${encodeURIComponent(input || proof)}`
if (input.length <= 120 && !/[\x00-\x1f]/.test(input)) {
  try {
    const preview = new Function('marker', `const preview = "${input}"; return preview;`)(marker)
    document.getElementById('preview').textContent = preview || input
  } catch (_) {
    document.getElementById('preview').textContent = 'Input could not be previewed'
  }
} else {
  document.getElementById('preview').textContent = 'Input rejected'
}
