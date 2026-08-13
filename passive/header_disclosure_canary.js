const inspectButton = document.getElementById('inspect-response')
const inspectionResult = document.getElementById('response-inspection')

inspectButton?.addEventListener('click', async () => {
  inspectButton.disabled = true
  inspectionResult.textContent = 'Inspecting the current response…'
  try {
    const response = await fetch(window.location.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`response_${response.status}`)
    const hasDisclosure = response.headers.has('x-powered-by')
    inspectionResult.textContent = hasDisclosure
      ? 'RESPONSE-METADATA-DISCLOSED'
      : 'RESPONSE-METADATA-CLEAN'
    inspectionResult.dataset.disclosure = hasDisclosure ? 'present' : 'absent'
  } catch {
    inspectionResult.textContent = 'Response metadata could not be inspected. Use the route-aware server.'
    inspectionResult.dataset.disclosure = 'error'
  } finally {
    inspectButton.disabled = false
  }
})
