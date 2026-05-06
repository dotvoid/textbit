#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const README = 'README.md'

const FORK_NOTE = '> This is the public npm distribution of [`ttab/textbit`](https://github.com/ttab/textbit), published as `@dotvoid/textbit`. The two packages track the same codebase.'

const NEW_INSTALL = `## Installation

\`\`\`bash
npm install @dotvoid/textbit
\`\`\`

`

function fail(msg) {
  console.error(`rewrite-readme: ${msg}`)
  process.exit(1)
}

const original = readFileSync(README, 'utf8')
let readme = original

const installRegex = /^## Installation\n[\s\S]*?(?=^## )/m
if (!installRegex.test(readme)) {
  fail('Installation section not found (expected "## Installation" followed by another "## " heading)')
}
readme = readme.replace(installRegex, NEW_INSTALL)

if ((readme.match(/^## Installation$/gm) ?? []).length !== 1) {
  fail('expected exactly one "## Installation" heading after rewrite')
}

const noteAlreadyPresent = readme.includes(`${FORK_NOTE}\n\n## Installation`)
if (!noteAlreadyPresent) {
  readme = readme.replace('## Installation', `${FORK_NOTE}\n\n## Installation`)
}

readme = readme.replaceAll('@ttab/textbit', '@dotvoid/textbit')

if (readme.includes('@ttab/textbit')) {
  fail('@ttab/textbit references still present after rewrite')
}
if (readme.includes('npm.pkg.github.com/ttab')) {
  fail('GitHub Packages registry reference still present after rewrite')
}
if (!readme.includes(FORK_NOTE)) {
  fail('fork note missing after rewrite')
}
if (!readme.includes('npm install @dotvoid/textbit')) {
  fail('install command missing after rewrite')
}

if (readme === original) {
  console.log('rewrite-readme: README.md already rebranded, no changes')
} else {
  writeFileSync(README, readme)
  console.log('rewrite-readme: README.md rewritten for @dotvoid publish')
}
