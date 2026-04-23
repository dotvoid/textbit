# Fork operations

This repo is a fork of [`ttab/textbit`](https://github.com/ttab/textbit) publishing `@dotvoid/textbit` to public npm. `main` mirrors upstream; `dotvoid` (default) carries fork-specific changes.

## Branches

- **`main`** — read-only mirror of `upstream/main`. Never commit here.
- **`dotvoid`** — default branch. All work and releases happen here.

## One-time local setup

```bash
git remote add upstream git@github.com:ttab/textbit.git
git fetch upstream
```

## Release a new version

From `dotvoid`:

```bash
npm version 1.3.0-dotvoid.3     # or 1.4.0 for a stable
git push --follow-tags
```

`preversion` runs tests + build. `postversion` pushes. Tag push triggers the publish workflow. Stable versions go to the `latest` dist-tag; any version with a `-` suffix goes to `next`.

Verify at https://github.com/dotvoid/textbit/actions and https://www.npmjs.com/package/@dotvoid/textbit.

## Pull in upstream changes

The sync workflow fast-forwards `main` every Sunday. To do it manually or after a new upstream release:

```bash
git checkout main
git pull                        # origin/main was synced by cron
git checkout dotvoid
git rebase main
git push origin dotvoid --force-with-lease
```

Only `package.json` / `package-lock.json` `version` fields should conflict — keep upstream's, then `npm version` to rebump.

If the sync workflow goes red, `main` has been contaminated with a direct commit. Reset it:

```bash
git checkout main
git reset --hard upstream/main
git push origin main --force-with-lease
```

## Roll back a bad npm release

```bash
npm dist-tag add @dotvoid/textbit@<last-good-version> latest
```

Then ship a fix as a new patch version. Don't `npm unpublish`.

## Contribute back to upstream

Branch from `main`, not `dotvoid`:

```bash
git checkout -b fix-something main
# ... commit the fix
git push origin fix-something
# open PR against ttab/textbit:main
```

## Where the fork magic lives

| Concern | Location |
|---------|----------|
| Package name (`@dotvoid/textbit`) | rewritten in `.github/workflows/publish-npm.yml` at publish time |
| Repo URLs (repository / homepage / bugs) | same |
| npm registry override | `publishConfig` deleted in CI (upstream's `publishConfig` points at GitHub Packages) |
| README branding | committed directly on `dotvoid` |
| Workflows | `.github/workflows/` on `dotvoid` only |

`package.json` on disk is byte-identical to upstream except for `version`. Don't add fork-specific fields — put them in the CI rewrite step instead.
