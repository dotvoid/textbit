# Releasing

Packages are published by GitHub Actions (`.github/workflows/publish-npm.yml`)
when a version tag is pushed, using npm trusted publishing. Nothing is published
from a developer machine.

Release a package from its folder:

```bash
cd packages/textbit           # or packages/plugins, packages/styles, packages/agent
npm version minor -m "%s: what changed"
```

That tests and builds the package, commits the new version with the lockfile, tags
it and pushes. The tag starts the workflow, which checks the tag against the
package version and publishes. Prerelease versions (`npm version preminor --preid
beta`) are published under the `next` dist-tag.

| Package | Folder | Tag |
|---------|--------|-----|
| `@dotvoid/textbit` | `packages/textbit` | `v1.10.0` |
| `@dotvoid/textbit-plugins` | `packages/plugins` | `textbit-plugins@0.1.0` |
| `@dotvoid/textbit-styles` | `packages/styles` | `textbit-styles@0.1.0` |
| `@dotvoid/textbit-agent` | `packages/agent` | `textbit-agent@0.1.0` |

npm skips its own commit and tag for packages in a workspace;
`scripts/commit-version.mjs`, run by each package's `postversion`, does both.

## Order

`@dotvoid/textbit-plugins` and `@dotvoid/textbit-agent` name the editor versions
they work with in their peer dependency on `@dotvoid/textbit`. npm checks that range against the editor in
this workspace, locally and in the workflow's `npm ci`, so it must match the
editor's version at every commit.

A minor or patch release of the editor needs nothing extra. A major release does:

1. Widen the plugins' range to cover both majors, e.g. `^2.0.0 || ^3.0.0`, and
   commit it.
2. Release the editor: `npm version major`.
3. Narrow the plugins' range to the new major, e.g. `^3.0.0`, and release the
   plugins. The same for the agent package.

Skipping step 1 breaks `npm ci`: once the editor's version leaves the range, npm
fetches an older editor from the registry for the plugins, which then conflicts
with everything else. That is what stopped the first 2.0.0 run.

The styles have no dependencies and can be released at any time.

### Textbit 3

The plugins and the agent package of 3.0 use the editor's 3.0 API (the headless
entry, plugins as definition and view), so they cannot be released before it:

1. Widen the plugins' range to `^2.0.0 || ^3.0.0` (the agent's already reads
   `^2.1.0 || ^3.0.0`) and commit it.
2. Release the editor: `npm version major`, giving 3.0.0.
3. Narrow both ranges to `^3.0.0`. Release the plugins (`npm version minor`,
   0.2.0) and the styles if they changed.
4. Release the agent package for the first time, as below: `npm version minor`,
   giving 0.1.0.

## The first release of a new package

Everything is published by the workflow, the first release of a package too.
npm trusted publishing can only be set up for a package that already exists on
the registry, so the first run publishes with a short-lived token instead:

1. On npmjs.com, create a granular access token with read and write access to
   the `@dotvoid` scope, expiring within a day.
2. In the GitHub repository, add it as the Actions secret `NPM_TOKEN`.
3. Release the package with `npm version` as usual. The workflow's publish step
   reads the secret.
4. Once the package is on npm: delete the `NPM_TOKEN` secret and revoke the
   token, then add the trusted publisher in the package's settings on npmjs.com
   (this repository, workflow `publish-npm.yml`).

From then on the package publishes through trusted publishing, like the editor.
For the first release of the plugins and the styles, do both while the token
exists, then set up both trusted publishers.
