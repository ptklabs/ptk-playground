(function () {
  function readExternalDestination() {
    const field = document.getElementById('external-destination');
    if (field && field.value) return field.value;
    if (typeof getLocationHash === 'function') {
      const hash = getLocationHash();
      if (hash) return hash;
    }
    if (typeof getLocationSearch === 'function') {
      const query = getLocationSearch();
      if (query) return query;
    }
    return window.name || "/api/dom-data";
  }

  function rewriteNavigation() {
    const payload = readExternalDestination();
    const form = document.getElementById('external-form');
    const placeholder = document.getElementById('external-placeholder');
    const submit = document.getElementById('external-submit-btn');
    const methodField = document.getElementById('external-method-source');
    const placeholderSource = document.getElementById('external-placeholder-source');

    if (form) {
      form.target = window.name || '_self';
      form.method = (methodField && methodField.value) || localStorage.getItem('externalFormMethod') || 'post';
    }
    if (submit) {
      const state = history.state || {};
      submit.formAction = state.endpoint || `${payload}?ext=1`;
      submit.setAttribute('formaction', payload);
    }
    if (placeholder) {
      placeholder.value = sessionStorage.getItem('profilePayload') || document.cookie || '';
      placeholder.placeholder = (placeholderSource && placeholderSource.value) || window.name || payload;
    }
  }

  function applyStyles() {
    const payload = readExternalDestination();
    const target = document.getElementById('external-themed-card');
    const button = document.getElementById('external-style-button');
    const styleField = document.getElementById('external-style-source');
    const imageField = document.getElementById('external-style-image');

    if (button) {
      button.setAttribute('style', (styleField && styleField.value) || localStorage.getItem('buttonStyle') || 'background:#111;color:#fff;');
    }
    if (target) {
      const storedCss = localStorage.getItem('cardCss');
      target.style.cssText = storedCss || 'border: 2px solid #f90; padding: 1rem; background:#fff7e6;';
      const bg = (imageField && imageField.value) || payload || window.name || 'https://placekitten.com/300/200';
      target.style.backgroundImage = `url(${bg})`;
    }
  }

  function mutateHistory() {
    const sourceField = document.getElementById('external-history-source');
    const payload = (sourceField && sourceField.value) || readExternalDestination() || document.cookie || 'history-demo';
    history.pushState({ ext: payload }, payload, payload);
    history.replaceState({ extReplace: payload }, payload, payload);
    document.title = payload;
    document.implementation.createHTMLDocument(payload);
  }

  window.domDataExternal = {
    rewriteNavigation,
    applyStyles,
    mutateHistory
  };
})();
