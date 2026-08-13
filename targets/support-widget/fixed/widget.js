const SUPPORT_ORIGIN = window.location.origin
const SUPPORT_PROOF = "WIDGET-SAFE-RENDER"
const supportStatus = document.getElementById("support-status")

function receiveSupportMessage(event) {
  if (event.origin !== SUPPORT_ORIGIN) return
  if (typeof event.data !== "string") return
  const message = { type: "support:reply", text: event.data }
  window.setTimeout(() => {
    document.getElementById("support-thread").textContent = message.text
    supportStatus.textContent = SUPPORT_PROOF
  }, 0)
}

window.addEventListener("message", receiveSupportMessage)

document.getElementById("send-support-message").addEventListener("click", () => {
  window.postMessage(
    "<strong data-support-proof=\"true\">Support request received</strong>",
    SUPPORT_ORIGIN
  )
})
