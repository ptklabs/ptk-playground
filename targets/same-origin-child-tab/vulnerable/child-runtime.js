const output = document.getElementById('child-message-output')
const status = document.getElementById('child-runtime-status')
const dependencyStatus = document.getElementById('child-dependency-status')
const apiStatus = document.getElementById('child-api-status')

function loadDependency() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = new URL('../../../assets/vendor/jquery/jquery-3.4.1.min.js', window.location.href).href
    script.addEventListener('load', resolve, { once: true })
    script.addEventListener('error', reject, { once: true })
    document.head.append(script)
  })
}

async function loadContext() {
  try {
    const response = await fetch('./api/context', {
      credentials: 'same-origin',
      headers: { 'X-Playground-Request': 'child-context' }
    })
    if (!response.ok) throw new Error('runtime unavailable')
    const context = await response.json()
    apiStatus.textContent = context.message
  } catch {
    apiStatus.textContent = 'Static mode: child context API is available in the local demo runtime.'
  }
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'ptk-workspace-message') return
  output.innerHTML = String(event.data.content || '')
  status.textContent = output.querySelector('[data-child-tab-proof]')
    ? 'RELATED-CHILD-MESSAGE-MARKUP'
    : 'RELATED-CHILD-MESSAGE-RECEIVED'
})

Promise.all([loadDependency(), loadContext()]).then(() => {
  dependencyStatus.textContent = `Child dependency ${window.jQuery.fn.jquery} loaded.`
  window.opener?.postMessage({ type: 'ptk-child-ready' }, window.location.origin)
}).catch(() => {
  dependencyStatus.textContent = 'The local child dependency could not be loaded.'
  status.textContent = 'RELATED-CHILD-DEPENDENCY-ERROR'
})
