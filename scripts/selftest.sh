#!/usr/bin/env bash
# Runs validate.mjs and generate.mjs against tests/fixtures in a throwaway copy of the repo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -r "$root/scripts" "$root/README.md" "$work/"
cp -r "$root/tests/fixtures/apps" "$work/apps"
cd "$work"

node scripts/validate.mjs
node scripts/generate.mjs >/dev/null
node scripts/generate.mjs --check
node scripts/validate.mjs

# latest/ is the newest stable version, not the release candidate.
cmp apps/sample-app/latest/azuredeploy.json apps/sample-app/1.0.0/azuredeploy.json
grep -q '| \[Sample App\](apps/sample-app/README.md) |.*| 1.0.0 |' README.md
grep -q '1.1.0-rc.1 (preview)' apps/sample-app/README.md
grep -q 'createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2Flinkcode-labs%2Fdeploy-offer-to-azure%2Fmain%2Fapps%2Fsample-app%2Flatest%2FcreateUiDefinition.json' README.md

# A secure parameter with a default value must be rejected.
sed -i 's/"registryPassword": { "type": "securestring" }/"registryPassword": { "type": "securestring", "defaultValue": "x" }/' \
  apps/sample-app/1.0.0/azuredeploy.json
if node scripts/validate.mjs 2>/dev/null; then echo "expected failure: secure default" >&2; exit 1; fi
cp "$root/tests/fixtures/apps/sample-app/1.0.0/azuredeploy.json" apps/sample-app/1.0.0/

# Unexpected files are rejected.
touch apps/sample-app/1.0.0/parameters.json
if node scripts/validate.mjs 2>/dev/null; then echo "expected failure: extra file" >&2; exit 1; fi
rm apps/sample-app/1.0.0/parameters.json

# Published versions are immutable; new versions are fine.
git init -q -b main . && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm base
mkdir apps/sample-app/1.0.1 && cp apps/sample-app/1.0.0/*.json apps/sample-app/1.0.1/
git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm add
node scripts/validate.mjs --base HEAD~1
echo ' ' >> apps/sample-app/1.0.0/azuredeploy.json
git -c user.name=t -c user.email=t@t commit -qam change
if node scripts/validate.mjs --base HEAD~1 2>/dev/null; then echo "expected failure: changed version" >&2; exit 1; fi

echo "selftest passed"
