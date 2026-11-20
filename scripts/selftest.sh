#!/usr/bin/env bash
# Runs validate.mjs and generate.mjs against templates/listing + tests/fixtures in a throwaway copy of the repo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -r "$root/scripts" "$root/README.md" "$work/"
cp -r "$root/tests/fixtures/apps" "$work/apps"
cp -r "$root/templates/listing/." "$work/apps/sample-app/"
cd "$work"
app=apps/sample-app

expect_fail() { # <description> <args...>
  local what="$1"; shift
  if node scripts/validate.mjs "$@" >/dev/null 2>&1; then echo "expected failure: $what" >&2; exit 1; fi
}

node scripts/validate.mjs
node scripts/generate.mjs >/dev/null
node scripts/generate.mjs --check
node scripts/validate.mjs

# latest/ is the newest stable version, not the release candidate, and has no release notes.
cmp $app/latest/azuredeploy.json $app/1.0.0/azuredeploy.json
test ! -e $app/latest/release-notes.md
grep -q '| \[Sample App\](apps/sample-app/README.md) | One line for the app list' README.md
grep -q 'createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Flinkcode-labs%2Fdeploy-offer-to-azure%2Fmain%2Fapps%2Fsample-app%2Flatest%2FcreateUiDefinition.json' README.md
# The app page follows the standard.
for heading in "## Overview" "### Features" "## Screenshots" "## Architecture" "### Resources created in your subscription" \
  "## Requirements" "## Cost" "## Security and data" "## Deployment parameters (version 1.0.0)" "## After deployment" \
  "## Support" "## Versions"; do
  grep -qxF "$heading" $app/README.md || { echo "missing section: $heading" >&2; exit 1; }
done
grep -q '^```mermaid$' $app/README.md
grep -q '| `registryPassword` | securestring | yes |  | Registry token from LinkCode. |' $app/README.md
grep -q '| `appUrl` | string | URL of the application. |' $app/README.md
grep -q '1.1.0-rc.1 (preview)' $app/README.md
grep -q '\[notes\](1.0.0/release-notes.md)' $app/README.md

cp -r "$app" /tmp/selftest-backup.$$
restore() { rm -rf "$app" && cp -r /tmp/selftest-backup.$$ "$app"; }

# Rejections.
sed -i 's/"type": "securestring",/"type": "securestring", "defaultValue": "x",/' $app/1.0.0/azuredeploy.json
expect_fail "secure default"; restore
sed -i 's/"description": "Region for all resources."/"description": ""/' $app/1.0.0/azuredeploy.json
expect_fail "parameter without description"; restore
touch $app/1.0.0/parameters.json
expect_fail "extra file in version"; restore
rm $app/architecture.mmd
expect_fail "missing diagram"; restore
echo "pie title x" > $app/architecture.mmd
expect_fail "wrong diagram type"; restore
node -e 'const f=process.argv[1];const m=require(f);delete m.security;require("fs").writeFileSync(f,JSON.stringify(m))' "$work/$app/app.json"
expect_fail "missing security section"; restore
node -e 'const f=process.argv[1];const m=require(f);m.architecture.resources[0].type="containerApps";require("fs").writeFileSync(f,JSON.stringify(m))' "$work/$app/app.json"
expect_fail "bad resource type"; restore
node -e 'const f=process.argv[1];const m=require(f);m.screenshots[0].file="media/nope.png";require("fs").writeFileSync(f,JSON.stringify(m))' "$work/$app/app.json"
expect_fail "missing screenshot"; restore
rm -rf /tmp/selftest-backup.$$
node scripts/validate.mjs

# Published versions are immutable; new versions are fine.
gitc() { git -c user.name=t -c user.email=t@t "$@"; }
git init -q -b main . && gitc add -A && gitc commit -qm base
mkdir $app/1.0.1 && cp $app/1.0.0/azuredeploy.json $app/1.0.0/createUiDefinition.json $app/1.0.1/
gitc add -A && gitc commit -qm add
node scripts/validate.mjs --base HEAD~1 >/dev/null
echo ' ' >> $app/1.0.0/azuredeploy.json
gitc commit -qam change
expect_fail "changed version" --base HEAD~1

echo "selftest passed"
