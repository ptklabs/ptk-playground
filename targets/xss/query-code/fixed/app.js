const proof = '";marker();//'
const input = new URLSearchParams(location.search).get('message') || ''
document.getElementById('proof-link').href = `?message=${encodeURIComponent(proof)}`
document.getElementById('compare-link').href = `/targets/xss/query-code/vulnerable/?message=${encodeURIComponent(input || proof)}`
document.getElementById('preview').textContent = input.length <= 120 && !/[\x00-\x1f]/.test(input) ? input : 'Input rejected'
