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

`@dotvoid/textbit-plugins` relies on textbit features that are not in 1.9.0: actions
sharing a key through `when()`, and AltGr typing never triggering shortcuts. Release
the editor first, then raise the plugins' peer dependency on `@dotvoid/textbit` to
that version, then release the plugins.

The next editor release must be 2.0.0: bold, italic and underline are no longer
built in (see "Upgrading from 1.x" in its README). The styles can go at any time.

## The first release of a new package

npm trusted publishing can only be set up for a package that already exists on the
registry, so a new package cannot be published by the workflow until it has been
published once. This applies to `@dotvoid/textbit-plugins` and
`@dotvoid/textbit-styles`. After that first publish, add the trusted publisher on
npmjs.com (package settings, Trusted Publisher: this repository and
`publish-npm.yml`), and every later release goes through the workflow.

How that first publish happens has not been decided. A manual `npm publish` breaks
the rule that nothing is published from a developer machine; the alternative is a
single workflow run with a short-lived npm access token stored as a repository
secret, removed afterwards.
