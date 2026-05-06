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
# resolve any conflicts (see below), then:
git push origin dotvoid --force-with-lease
```

Expected conflicts and how to resolve them:

- **`package.json` / `package-lock.json` `version` fields** — take upstream's (`git checkout --ours <file>`), then run `npm version <upstream-version>` after the rebase finishes to set a fresh version tag.
- **`README.md`** — take upstream's content, then re-apply branding:
  ```bash
  git checkout --theirs README.md
  node scripts/rewrite-readme.mjs
  git add README.md
  git rebase --continue
  ```
  The script is idempotent and validates its output, so a clean run means the rebranded README is ready to commit.

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
| README branding | `scripts/rewrite-readme.mjs` — committed to `dotvoid` and re-run by CI on publish (idempotent) |
| Workflows | `.github/workflows/` on `dotvoid` only |

`package.json` on disk is byte-identical to upstream except for `version`. `README.md` on disk is the rebranded form (so the GitHub repo page shows correct install instructions); upstream README changes flow in via the sync conflict recipe above. The publish workflow re-runs the rebrand script at build time as a safety net — if `dotvoid`'s README ever drifts, CI catches it. Don't add fork-specific fields to `package.json` — put them in the CI rewrite step instead. If the README script ever fails, upstream restructured the README in a way the script can't handle; update the script rather than hand-editing branding back in.
