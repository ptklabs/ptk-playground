import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex')
}

const jquery = readJson('assets/vendor/jquery/SOURCE.json')
const angular = readJson('assets/vendor/angularjs/SOURCE.json')

for (const [file, metadata] of Object.entries(jquery.files)) {
  const relativePath = `assets/vendor/jquery/${file}`
  if (sha256(relativePath) !== metadata.sha256) throw new Error(`jQuery provenance hash mismatch: ${relativePath}`)
}
for (const [file, expected] of Object.entries(angular.files)) {
  const relativePath = `assets/vendor/angularjs/${file}`
  if (sha256(relativePath) !== expected) throw new Error(`AngularJS provenance hash mismatch: ${relativePath}`)
}

const scenarios = [
  {
    id: 'sca.jquery.support-widget.initial',
    title: 'Support widget dependency loaded with the document',
    canonicalChallengeId: 'support-widget',
    loadingCondition: 'initial-document',
    package: 'jquery',
    license: jquery.license,
    review: {
      version: jquery.files['jquery-3.4.1.min.js'].version,
      targetRoute: './targets/support-widget/vulnerable/',
      resourceRoute: './assets/vendor/jquery/jquery-3.4.1.min.js',
      sha256: jquery.files['jquery-3.4.1.min.js'].sha256
    },
    repaired: {
      version: jquery.files['jquery-3.7.1.min.js'].version,
      targetRoute: './targets/support-widget/fixed/',
      resourceRoute: './assets/vendor/jquery/jquery-3.7.1.min.js',
      sha256: jquery.files['jquery-3.7.1.min.js'].sha256
    }
  },
  {
    id: 'sca.jquery.analytics.action-loaded',
    title: 'Analytics dependency loaded only after a browser action',
    canonicalChallengeId: 'on-demand-analytics',
    loadingCondition: 'user-action',
    triggerSelector: '#load-analytics',
    package: 'jquery',
    license: jquery.license,
    review: {
      version: jquery.files['jquery-3.4.1.min.js'].version,
      targetRoute: './targets/on-demand-analytics/vulnerable/',
      resourceRoute: './assets/vendor/jquery/jquery-3.4.1.min.js',
      sha256: jquery.files['jquery-3.4.1.min.js'].sha256
    },
    repaired: {
      version: jquery.files['jquery-3.7.1.min.js'].version,
      targetRoute: './targets/on-demand-analytics/fixed/',
      resourceRoute: './assets/vendor/jquery/jquery-3.7.1.min.js',
      sha256: jquery.files['jquery-3.7.1.min.js'].sha256
    }
  },
  {
    id: 'sca.angularjs.expression.initial',
    title: 'Expression workspace removes an end-of-life client framework',
    canonicalChallengeId: 'angular-expression-dependency',
    loadingCondition: 'initial-document',
    package: angular.package,
    license: angular.license,
    review: {
      version: angular.version,
      targetRoute: './targets/angular-expression-dependency/review/',
      resourceRoute: './assets/vendor/angularjs/angular.min.js',
      sha256: angular.files['angular.min.js']
    },
    repaired: {
      version: null,
      targetRoute: './targets/angular-expression-dependency/fixed/',
      resourceRoute: null,
      controlStrategy: 'dependency-removed'
    }
  },
  {
    id: 'sca.jquery.lazy-route.dynamic-import',
    title: 'Analytics dependency loaded by a dynamically imported SPA route',
    canonicalChallengeId: 'lazy-route-module',
    loadingCondition: 'user-action',
    triggerSelector: '#open-analytics-route',
    package: 'jquery',
    license: jquery.license,
    review: {
      version: jquery.files['jquery-3.4.1.min.js'].version,
      targetRoute: './targets/lazy-route-module/vulnerable/',
      resourceRoute: './assets/vendor/jquery/jquery-3.4.1.min.js',
      sha256: jquery.files['jquery-3.4.1.min.js'].sha256
    },
    repaired: {
      version: jquery.files['jquery-3.7.1.min.js'].version,
      targetRoute: './targets/lazy-route-module/fixed/',
      resourceRoute: './assets/vendor/jquery/jquery-3.7.1.min.js',
      sha256: jquery.files['jquery-3.7.1.min.js'].sha256
    }
  },
  {
    id: 'sca.jquery.related-child.document',
    title: 'Dependency loaded only inside a causally related child tab',
    canonicalChallengeId: 'same-origin-child-tab',
    loadingCondition: 'child-document',
    triggerSelector: '#open-related-child',
    package: 'jquery',
    license: jquery.license,
    review: {
      version: jquery.files['jquery-3.4.1.min.js'].version,
      targetRoute: './targets/same-origin-child-tab/vulnerable/',
      resourceRoute: './assets/vendor/jquery/jquery-3.4.1.min.js',
      sha256: jquery.files['jquery-3.4.1.min.js'].sha256
    },
    repaired: {
      version: jquery.files['jquery-3.7.1.min.js'].version,
      targetRoute: './targets/same-origin-child-tab/fixed/',
      resourceRoute: './assets/vendor/jquery/jquery-3.7.1.min.js',
      sha256: jquery.files['jquery-3.7.1.min.js'].sha256
    }
  }
]

const packages = [
  {
    name: jquery.package,
    license: jquery.license,
    provenanceFile: './assets/vendor/jquery/SOURCE.json',
    licenseFile: './assets/vendor/jquery/LICENSE.txt',
    versions: [jquery.files['jquery-3.4.1.min.js'].version, jquery.files['jquery-3.7.1.min.js'].version]
  },
  {
    name: angular.package,
    license: angular.license,
    provenanceFile: './assets/vendor/angularjs/SOURCE.json',
    licenseFile: './assets/vendor/angularjs/LICENSE.md',
    versions: [angular.version]
  }
]

const document = {
  schema: 'owasp-ptk-playground-sca-dependencies/v1',
  version: 1,
  summary: {
    packages: packages.length,
    scenarios: scenarios.length,
    actionLoaded: scenarios.filter((scenario) => scenario.loadingCondition === 'user-action').length,
    pairedControls: scenarios.filter((scenario) => scenario.repaired).length
  },
  packages,
  scenarios
}

const output = `${JSON.stringify(document, null, 2)}\n`
const target = path.join(repoRoot, 'catalog/sca-dependencies.json')
if (checkOnly) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) throw new Error('catalog/sca-dependencies.json is stale; run npm run catalog:generate')
} else {
  fs.writeFileSync(target, output)
}
console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'write', ...document.summary }))
