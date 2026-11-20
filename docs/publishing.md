# Publishing an application version

Application repositories (`com-<app>`, private) publish here on release. This repository never pulls from them and
holds no credentials; the app repository opens a pull request, the `validate` check runs, and the PR merges itself.

```text
com-<app> release (tag vX.Y.Z)
  bicep build deploy/azure/main.bicep -> azuredeploy.json
  customer package test (test subscription)          <- must pass before publishing
  publish job (GitHub App token, this repo only)
    apps/<app>/X.Y.Z/{azuredeploy.json,createUiDefinition.json,release-notes.md}
    apps/<app>/{app.json,architecture.mmd,media/}   (copied from deploy/azure/listing/)
    node scripts/generate.mjs   -> latest/, app page, main README
    PR "Publish <app> X.Y.Z" + auto-merge
deploy-offer-to-azure
  validate.yml: self-test, validate.mjs (structure, schemas, secrets, immutable versions), generate.mjs --check
```

## Layout

```text
README.md                         list of apps with buttons (section between apps:start/apps:end is generated)
apps/<app>/app.json               listing texts and resources (docs/app-page-standard.md), from the app repo
apps/<app>/architecture.mmd       Mermaid architecture diagram, from the app repo
apps/<app>/media/                 optional screenshots, from the app repo
apps/<app>/README.md              generated app page in the standard layout
apps/<app>/latest/                generated copy of the newest stable version (newest prerelease if none)
apps/<app>/<x.y.z>/               azuredeploy.json, createUiDefinition.json, optional release-notes.md;
                                  immutable once merged
templates/listing/                starting point for deploy/azure/listing/ in an app repo
scripts/                          generate.mjs, validate.mjs, selftest.sh (Node 20+, no dependencies)
```

`<app>` is the repository name without the `com-` prefix (`com-rag-chat` -> `rag-chat`). Versions have no leading
`v` (tag `v1.2.0` -> `1.2.0`); prereleases (`1.3.0-rc.1`) are listed as previews and never become `latest` while a
stable version exists.

## App page

Every app page has the same sections; the content and the rules are in
[app-page-standard.md](app-page-standard.md). The app repository keeps it in `deploy/azure/listing/` and the publish
job copies it on every release, so texts and the diagram can change with any new version.

## Rules enforced by `validate`

- Only `app.json`, `architecture.mmd`, `README.md`, `media/`, `latest/` and version folders inside an app; only the
  two package files (and `release-notes.md`) inside a version.
- `app.json` has every required section of the [app page standard](app-page-standard.md); `architecture.mmd` is a
  Mermaid diagram; screenshots exist and are at most 1 MB.
- Every template parameter and output has `metadata.description`.
- `azuredeploy.json` has the ARM deployment template schema; `createUiDefinition.json` has the CreateUIDefinition
  schema, handler and `parameters.outputs`.
- `securestring`/`secureObject` parameters have no default value; no private keys, storage keys, SAS or GitHub/Slack
  tokens anywhere.
- Files in an already published version cannot be changed or deleted. Fix a bad release with a new version.
- Generated files match `scripts/generate.mjs`.

## One-time setup

### This repository

1. Settings > General: allow auto-merge, allow squash merging only, automatically delete head branches.
2. Settings > Rules > Rulesets: a ruleset on the default branch with "Require a pull request before merging" (0
   approvals) and "Require status checks to pass" with the check `validate`. Do not require reviews: release PRs
   from app repositories merge on their own after the check.
3. Settings > Actions > General: workflow permissions "Read repository contents"; require approval for fork PRs.

### Publisher GitHub App

One GitHub App owned by `linkcode-labs` publishes for every app repository. A GitHub App is preferred over a personal
token: it does not belong to a person, does not expire with someone's account, and its installation is limited to
this repository.

1. Organization settings > Developer settings > GitHub Apps > New GitHub App:
   name `linkcode-offer-publisher`, homepage `https://github.com/linkcode-labs`, webhook off,
   repository permissions **Contents: Read and write**, **Pull requests: Read and write** (Metadata: read is added
   automatically), "Only on this account".
2. Generate a private key (downloads a `.pem`).
3. Install the app on `linkcode-labs`, **Only select repositories: `deploy-offer-to-azure`**.
4. In every `com-<app>` repository that publishes, environment `release`:
   variable `OFFER_PUBLISHER_APP_ID` (the app's ID) and secret `OFFER_PUBLISHER_PRIVATE_KEY` (contents of the
   `.pem`). Organization-level variables and secrets work too if the organization plan allows them for private
   repositories.

## Publish job for `com-<app>`

Add to the app's `release.yml` after the job that builds the package and the customer package test.
TODO: move to `com-offer-shared` as the reusable workflow `publish-deploy-button.yml` once that repository exists.

```yaml
  publish-deploy-button:
    needs: [package, test-customer-deploy]
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: read                   # also lets GITHUB_TOKEN read this repo's release notes
    env:
      APP: rag-chat   # repository name without "com-"
    steps:
      - uses: actions/checkout@v4
        with:
          path: app
      - uses: actions/download-artifact@v4
        with:
          name: azure-package          # azuredeploy.json + createUiDefinition.json from the package job
          path: package
      - id: token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ vars.OFFER_PUBLISHER_APP_ID }}
          private-key: ${{ secrets.OFFER_PUBLISHER_PRIVATE_KEY }}
          owner: linkcode-labs
          repositories: deploy-offer-to-azure
      - uses: actions/checkout@v4
        with:
          repository: linkcode-labs/deploy-offer-to-azure
          token: ${{ steps.token.outputs.token }}
          path: offer
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Open publish PR
        working-directory: offer
        env:
          GH_TOKEN: ${{ steps.token.outputs.token }}
          APP_TOKEN: ${{ github.token }}
          BOT: ${{ steps.token.outputs.app-slug }}[bot]
        run: |
          set -euo pipefail
          version="${GITHUB_REF_NAME#v}"
          dir="apps/$APP/$version"
          if [ -e "$dir" ]; then echo "::error::$dir is already published"; exit 1; fi
          mkdir -p "$dir"
          cp ../package/azuredeploy.json ../package/createUiDefinition.json "$dir/"
          GH_TOKEN="$APP_TOKEN" gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --json body --jq .body \
            > "$dir/release-notes.md" || true
          [ -s "$dir/release-notes.md" ] || rm -f "$dir/release-notes.md"
          # Listing: replace, so files removed in the app repo disappear here too.
          rm -rf "apps/$APP/media"
          cp -r ../app/deploy/azure/listing/. "apps/$APP/"
          node scripts/generate.mjs
          node scripts/validate.mjs

          branch="publish/$APP-$version"
          git config user.name "$BOT"
          git config user.email "$(gh api "/users/${BOT}" --jq .id)+${BOT}@users.noreply.github.com"
          git switch -c "$branch"
          git add -A apps README.md
          git commit -m "Publish $APP $version"
          git push origin "$branch"
          gh pr create --head "$branch" --title "Publish $APP $version" \
            --body "Automated release of $APP $version."
          gh pr merge "$branch" --squash --auto
```

The PR body must not name the private repository or link to it: everything here is public.

## By hand

For a first test or an app without CI yet: copy `templates/listing/` to `apps/<app>/`, fill it in, add the version
folder, run
`node scripts/generate.mjs && node scripts/validate.mjs`, and open a PR.

## Testing a button before release

The button works with any public raw URL. To try a template from a branch, open
`https://portal.azure.com/#create/Microsoft.Template/uri/<encoded azuredeploy.json URL>/createUIDefinitionUri/<encoded createUiDefinition.json URL>`
with the branch name in the raw URLs, or test the form alone in the
[CreateUIDefinition sandbox](https://portal.azure.com/#blade/Microsoft_Azure_CreateUIDef/SandboxBlade).
