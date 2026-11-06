# Releasing

Packages are published by GitHub Actions (`.github/workflows/publish-npm.yml`)
when a version tag is pushed, using npm trusted publishing. Nothing is published
from a developer machine.

Release a package from its folder:

```bash
cd packages/textbit           # or packages/plugins, packages/styles
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

npm skips its own commit and tag for packages in a workspace;
`scripts/commit-version.mjs`, run by each package's `postversion`, does both.

## Order

1. `@dotvoid/textbit` 2.0.0, a major release: types and marks are named `base/*`,
   bold, italic and underline are no longer built in, and it needs Slate 0.147
   (see "Upgrading from 1.x" in its README). `npm version major`.
2. `@dotvoid/textbit-styles` 0.1.0, any time. `npm version minor`.
3. `@dotvoid/textbit-plugins` 0.1.0, after the editor: it needs textbit 2.0.0.
   First raise its peer dependency on `@dotvoid/textbit` from `^1.9.0` to
   `^2.0.0` and commit that. It cannot be raised earlier: until the editor's
   version is 2.0.0, npm finds no match and refuses to install. Then
   `npm version minor`.

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
