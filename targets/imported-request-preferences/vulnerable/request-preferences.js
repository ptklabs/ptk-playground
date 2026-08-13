const input = document.getElementById('preferences-json')
const details = document.getElementById('request-details')
const preview = document.getElementById('preview-message')
const status = document.getElementById('preferences-status')
const preparedPreferences = '{"__proto__":{"credentials":"include"}}'

async function importPreferences() {
  try {
    const imported = JSON.parse(input.value)
    const requestOptions = Object.assign({}, imported)
    const response = await fetch('../preview.json', requestOptions)
    const accountPreview = await response.json()
    const hasOwnCredentials = Object.prototype.hasOwnProperty.call(requestOptions, 'credentials')

    details.textContent = [
      `Own option keys: ${Object.keys(requestOptions).join(', ') || '(none)'}`,
      `Own credentials: ${hasOwnCredentials ? requestOptions.credentials : '(none)'}`,
      `Inherited credentials: ${hasOwnCredentials ? '(none)' : String(requestOptions.credentials)}`
    ].join('\n')
    preview.textContent = accountPreview.message
    status.textContent = !hasOwnCredentials && requestOptions.credentials === 'include'
      ? 'PREFERENCE-INHERITED-REQUEST-OPTION'
      : 'PREFERENCE-REVIEW-UNEXPECTED'
  } catch (error) {
    details.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`
    preview.textContent = 'The local account preview was not loaded.'
    status.textContent = 'PREFERENCE-IMPORT-ERROR'
  }
}

function resetPreferences() {
  input.value = preparedPreferences
  details.textContent = 'No preferences have been imported.'
  preview.textContent = 'The local account preview has not been requested.'
  status.textContent = 'PREFERENCES-IDLE'
}

document.getElementById('import-preferences').addEventListener('click', importPreferences)
document.getElementById('reset-preferences').addEventListener('click', resetPreferences)
