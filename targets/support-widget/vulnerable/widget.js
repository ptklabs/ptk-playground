const SUPPORT_PROOF = "WIDGET-MESSAGE-RENDERED"
const supportThread = document.getElementById("support-thread")
const supportStatus = document.getElementById("support-status")
const sendButton = document.getElementById("send-support-message")

window.addEventListener("message", (event) => {
  const message = { type: "support:reply", html: event.data }
  window.setTimeout(() => {
    $("#support-thread").html(message.html)
    if (supportThread.querySelector("[data-support-proof]")) {
      supportStatus.textContent = SUPPORT_PROOF
    }
  }, 0)
})

sendButton.addEventListener("click", () => {
  window.postMessage(
    "<strong data-support-proof=\"true\">Support request received</strong>",
    window.location.origin
  )
})
