// npm version skips the git commit and tag for packages in a workspace. Run as a
// package's postversion script, this does what npm does outside one: commit the
// bumped package.json and the lockfile, and add an annotated tag carrying the
// same message. `npm version -m "%s: ..."` messages work as before.
//
// Usage, from a package folder: node ../../scripts/commit-version.mjs [tag prefix]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const prefix = process.argv[2] ?? 'v'
const version = process.env.npm_package_version
if (!version) {
  console.error('commit-version: run this from an npm version lifecycle script')
  process.exit(1)
}

const message = (process.env.npm_config_message || '%s').replaceAll('%s', version)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const root = git('rev-parse', '--show-toplevel')

// npm updates this package's version in the root lockfile only after
// postversion has run, which would leave the lockfile uncommitted. Make the same
// change now, so it is in the commit and npm's later write changes nothing.
const lockPath = join(root, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const entry = lock.packages?.[relative(root, process.cwd()).split(sep).join('/')]
if (entry) {
  entry.version = version
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
}

git('add', 'package.json', lockPath)
git('commit', '-m', message)
git('tag', '-a', `${prefix}${version}`, '-m', message)
console.log(`${prefix}${version}`)
