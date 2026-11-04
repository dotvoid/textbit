// npm version skips the git commit and tag for packages in a workspace. Run as a
// package's postversion script, this does what npm does outside one: commit the
// bumped package.json and the lockfile, and add an annotated tag carrying the
// same message. `npm version -m "%s: ..."` messages work as before.
//
// Usage, from a package folder: node ../../scripts/commit-version.mjs [tag prefix]
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const prefix = process.argv[2] ?? 'v'
const version = process.env.npm_package_version
if (!version) {
  console.error('commit-version: run this from an npm version lifecycle script')
  process.exit(1)
}

const message = (process.env.npm_config_message || '%s').replaceAll('%s', version)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const root = git('rev-parse', '--show-toplevel')

git('add', 'package.json', join(root, 'package-lock.json'))
git('commit', '-m', message)
git('tag', '-a', `${prefix}${version}`, '-m', message)
console.log(`${prefix}${version}`)
