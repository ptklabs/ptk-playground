const input = document.getElementById('preferences-json')
const details = document.getElementById('request-details')
const preview = document.getElementById('preview-message')
const status = document.getElementById('preferences-status')
const preparedPreferences = '{"__proto__":{"credentials":"include"}}'
async function importPreferences() {
  try {
    const imported = JSON.parse(input.value)
    const requestOptions = Object.create(null)
    if (
      Object.prototype.hasOwnProperty.call(imported, 'credentials') &&
      imported.credentials === 'omit'
    ) {
      requestOptions.credentials = 'omit'
    } else {
      requestOptions.credentials = 'same-origin'
    }
    const response = await fetch('../preview.json', requestOptions)
    const accountPreview = await response.json()

    details.textContent = [
      `Own option keys: ${Object.keys(requestOptions).join(', ')}`,
      `Own credentials: ${requestOptions.credentials}`,
      `Prototype: ${Object.getPrototypeOf(requestOptions) === null ? 'none' : 'present'}`
    ].join('\n')
    preview.textContent = accountPreview.message
    status.textContent = requestOptions.credentials === 'same-origin'
      ? 'PREFERENCE-ALLOWLISTED-REQUEST-OPTION'
      : 'PREFERENCE-REPAIRED-OPTION-APPLIED'
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
