const status = document.getElementById('child-launcher-status')
const externalButton = document.getElementById('open-external-control')
const externalNote = document.getElementById('external-control-note')
const preparedMessage = '<strong data-child-tab-proof="true">Support workspace connected</strong>'
let relatedChild = null

document.getElementById('open-related-child').addEventListener('click', () => {
  relatedChild = window.open('./child.html', 'ptk-related-child-review')
  status.textContent = relatedChild ? 'RELATED-CHILD-OPENING' : 'RELATED-CHILD-POPUP-BLOCKED'
})

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== relatedChild) return
  if (event.data?.type === 'ptk-child-ready') {
    relatedChild.postMessage({ type: 'ptk-workspace-message', content: preparedMessage }, window.location.origin)
    status.textContent = 'RELATED-SAME-ORIGIN-CHILD-CONNECTED'
  }
})

if (window.location.hostname === '127.0.0.1' && window.location.protocol === 'http:' && window.location.port === '3080') {
  externalButton.hidden = false
  externalNote.textContent = 'This control changes hostname and receives no workspace message.'
  externalButton.addEventListener('click', () => {
    const rootPath = new URL('../../../', window.location.href).pathname
    window.open(`http://localhost:${window.location.port}${rootPath}targets/same-origin-child-tab/control/`, 'ptk-unrelated-origin-control', 'noopener')
  })
}
