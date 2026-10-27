import fs from 'node:fs'

import { validatePlatformManifest } from '../src/manifest.js'

const file = 'package.json'
const bytes = fs.readFileSync(file)
if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
  console.error(`${file}: UTF-8 BOM is not allowed`)
  process.exit(1)
}
const pkg = JSON.parse(bytes.toString('utf8'))
const validation = validatePlatformManifest(pkg)
if (!validation.ok) {
  for (const error of validation.errors) console.error(`${file}: ${error}`)
  process.exit(1)
}
for (const warning of validation.warnings) console.warn(`${file}: ${warning}`)
console.log(`${file}: ok (contract ${validation.contract})`)
