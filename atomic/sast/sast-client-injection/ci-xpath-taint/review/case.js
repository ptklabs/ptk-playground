const input = document.querySelector('#case-input')
const output = document.querySelector('#output')
const evidence = document.querySelector('#evidence')
const trigger = document.querySelector('#run-case')

input.value = "{\"name\":\"PTK evidence\",\"__proto__\":{\"ptk\":true}}"

trigger.addEventListener('click', () => {
  evidence.dataset.state = 'running'
  evidence.textContent = 'Running…'
  try {
    const expression = "//user[name='" + input.value + "']";
    document.evaluate(expression, document, null, XPathResult.ANY_TYPE, null);
    evidence.textContent = expression;
    evidence.dataset.state = 'complete'
  } catch (error) {
    evidence.dataset.state = 'boundary'
    evidence.textContent = 'Operation reached the browser boundary: ' + error.name
  }
})
