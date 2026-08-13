const loadButton = document.getElementById('load-analytics')
const summary = document.getElementById('analytics-summary')
const status = document.getElementById('analytics-status')
const repaired = document.body.dataset.targetVariant === 'fixed'
const dependencyPath = repaired
  ? '../../assets/vendor/jquery/jquery-3.7.1.min.js'
  : '../../assets/vendor/jquery/jquery-3.4.1.min.js'

loadButton?.addEventListener('click', () => {
  loadButton.disabled = true
  status.textContent = 'Requesting the local analytics dependency…'
  const dependency = document.createElement('script')
  dependency.src = new URL(dependencyPath, import.meta.url).href
  dependency.addEventListener('load', () => {
    window.jQuery(summary).text('Three completed orders · £148.50 total')
    status.textContent = repaired
      ? 'ANALYTICS-DEPENDENCY-REVIEWED'
      : 'ANALYTICS-DEPENDENCY-LOADED'
  }, { once: true })
  dependency.addEventListener('error', () => {
    loadButton.disabled = false
    status.textContent = 'The local analytics dependency could not be loaded.'
  }, { once: true })
  document.head.append(dependency)
}, { once: true })
