(function () {
  function tryParsePayload(raw) {
    if (!raw) return "";
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  function ensureFrameReady(frame) {
    if (!frame) return null;
    if (!frame.srcdoc) {
      frame.srcdoc = `
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><title>Message target</title></head>
        <body>
          <script>
            window.addEventListener('message', function(event){
              if (event.source && event.source.postMessage) {
                event.source.postMessage({ mirror: event.data, origin: location.origin }, '*');
              }
            });
          </script>
        </body>
        </html>
      `;
    }
    return frame.contentWindow;
  }

  function sendSameOrigin(payload, frameWin) {
    try {
      frameWin.postMessage(payload, window.location.origin);
    } catch (err) {
      console.warn('Unable to post same-origin message', err);
    }
  }

  function broadcastMissingTarget(payload) {
    if (typeof window.broadcastWithoutTarget === "function") {
      window.broadcastWithoutTarget(payload);
    } else {
      window.postMessage(payload);
    }
  }

  function wireButtons() {
    const payloadField = document.getElementById('messagePayload');
    const frame = document.getElementById('message-target');
    const targetWin = ensureFrameReady(frame);

    if (!payloadField || !frame || !targetWin) return;

    const actions = {
      "send-wildcard": () => {
        const payload = tryParsePayload(payloadField.value);
        if (typeof window.sendWildcardMessage === "function") {
          window.sendWildcardMessage(payload);
        }
      },
      "send-same-origin": () => {
        const payload = tryParsePayload(payloadField.value);
        sendSameOrigin(payload, targetWin);
      },
      "broadcast-missing-target": () => {
        const payload = tryParsePayload(payloadField.value);
        broadcastMissingTarget(payload);
      }
    };

    document.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.getAttribute('data-action');
      if (!action || !actions[action]) return;
      btn.addEventListener('click', actions[action]);
    });

    window.addEventListener('message', (event) => {
      const log = document.getElementById('wm-safe-preview');
      if (log && event.data && event.data.mirror && event.source === targetWin) {
        log.dataset.lastMirrored = JSON.stringify(event.data.mirror);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', wireButtons);
})();
