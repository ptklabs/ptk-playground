// Deliberately unsafe review sink: interpret the stored value as markup.
window.renderSavedMessage = (element, message) => { element.innerHTML = message }
