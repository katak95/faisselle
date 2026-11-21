<!-- rebrand: keep-file (this page is about Yogurt) -->
# Following Yogurt

Figolu is a fork of [Yogurt](https://github.com/FrigadeHQ/yogurt). Yogurt's new changes come into Figolu by
themselves, every day, through [`.github/workflows/sync-yogurt.yml`](../.github/workflows/sync-yogurt.yml) (Actions →
Follow Yogurt, which also runs by hand: *Run workflow*).

## How it works

1. **Yogurt, renamed.** The `yogurt-figolu` branch holds Yogurt as it would be if it were called Figolu: each run takes
   Yogurt's `main`, runs [`app/scripts/rebrand.py`](../app/scripts/rebrand.py) on it and commits the result there
   (its message says which Yogurt commit it is: `yogurt-sha: …`). Figolu itself is already what that script makes
   (`app/test/rebrand.test.ts` checks it), so merging the branch only brings Yogurt's real changes: not the 7,500 lines
   the name touches.
2. **Merged into main.** `yogurt-figolu` is merged into `main` on a `sync/yogurt` branch. The translation tables merge
   key by key ([`app/scripts/merge-json.mjs`](../app/scripts/merge-json.mjs), registered in `.gitattributes`), so the
   texts both sides add at their end never conflict.
3. **Checked.** Typecheck, unit tests and the app's build run on the merge. All green: `main` moves forward (and CI runs
   the end-to-end tests there as usual).
4. **Released.** When Yogurt's version in `main` has no Figolu release yet, it is tagged: Yogurt X.Y.Z is Figolu
   X.Y.(Z×100), so Yogurt 0.3.62 is Figolu **0.3.6200**. [`release.yml`](../.github/workflows/release.yml) builds Mac,
   Windows and Linux, publishes the release, and installed copies update from it.

When something stops it, `main` doesn't move and a pull request says what to do:

- **Conflicts** ("Yogurt X: conflicts to resolve", from `yogurt-figolu`): Yogurt changed lines Figolu changed too.
- **Failed checks** ("Yogurt X: checks to fix", from `sync/yogurt`): it merges, but something no longer builds or
  passes, like when Yogurt 0.3.62 replaced its icon library and Figolu's own screens still used the old one.

Once that pull request is merged, the next run releases it.

## Set up once

The workflow needs a **`SYNC_TOKEN`** secret (Settings → Secrets and variables → Actions → New repository secret): a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) limited to
`katak95/figolu`, with these repository permissions, read and write:

- **Contents** (push `main`, `yogurt-figolu` and tags),
- **Pull requests** (open the pull requests above),
- **Workflows** (Yogurt's changes can touch `.github/workflows`).

GitHub's own `GITHUB_TOKEN` isn't enough: what it pushes doesn't start CI or the release, and it can't change
workflows. Without the secret the workflow stops at its first step and says so.

## Resolving a conflict

```sh
git fetch origin && git checkout main && git pull
git config merge.locale-json.driver "node app/scripts/merge-json.mjs %O %A %B"
git merge origin/yogurt-figolu
# fix the files git lists, then
pnpm -C app typecheck && pnpm -C app test
git commit && git push
```

Keep Figolu's change and Yogurt's both where you can. A line that must keep the name Yogurt (a credit, the folder
migration) gets `rebrand: keep` in a comment on it, or names Figolu or Frigade; a whole file, `rebrand: keep-file`.

## Releasing a Figolu change between two Yogurt versions

```sh
sh app/scripts/figolu-release.sh
```

It tags `main` with the next number (Figolu 0.3.6201, 0.3.6202…, [`app/scripts/version.mjs`](../app/scripts/version.mjs))
and pushes the tag. `app/package.json` keeps Yogurt's version; the release takes the tag's.

## Limits

- **Mac updates need Apple signing.** A Mac only updates itself to a signed and notarized app. Without the Apple
  secrets (`MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
  from an Apple Developer account), the Mac build is unsigned: it is published, but each new version is downloaded by
  hand. Windows and Linux update by themselves either way (Windows warns about an unsigned installer the first time).
- **Yogurt's own website and Discord.** Figolu links to its repository instead of Yogurt's website; the menu's
  Discord is still Yogurt's.
- `yogurt-figolu` is managed by the workflow: don't commit to it by hand.
