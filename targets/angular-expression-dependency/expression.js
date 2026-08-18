const input = document.getElementById('expression')
const result = document.getElementById('expression-result')
const review = document.documentElement.dataset.dependencyVariant === 'review'
if (review) window.angular.module('ptkAngularFixture', [])

document.getElementById('parse-expression').addEventListener('click', () => {
  try {
    let value
    if (review) {
      const injector = window.angular.element(document.documentElement).injector()
      value = injector.get('$parse')(input.value)({ value: 2 })
    } else {
      const operations = new Map([
        ['value', (current) => current],
        ['value + 1', (current) => current + 1],
        ['value - 1', (current) => current - 1]
      ])
      const operation = operations.get(input.value.trim())
      if (!operation) throw new Error('Expression is not in the supported operation list')
      value = operation(2)
    }
    result.textContent = `Result: ${String(value)}`
  } catch (error) {
    result.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
  }
})
