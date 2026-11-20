#!/usr/bin/env node
// Checks the apps/ tree. Everything here is public, so this is the last gate before customers.
//
// Usage: node scripts/validate.mjs                 check the working tree
//        node scripts/validate.mjs --base <ref>    also check that published versions were not changed
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, APPS_DIR, PACKAGE_FILES, SEMVER, listDirs } from "./lib.mjs";

const errors = [];
const fail = (path, msg) => errors.push(`${path}: ${msg}`);

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/AccountKey=[A-Za-z0-9+/=]{20,}/, "storage account key"],
  [/SharedAccessSignature=|[?&]sig=[A-Za-z0-9%+/=]{20,}/, "SAS token"],
  [/\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "GitHub token"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
];

function parse(path) {
  const text = readFileSync(path, "utf8");
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) fail(path, `looks like it contains a ${what}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(path, `invalid JSON (${e.message})`);
    return null;
  }
}

function checkTemplate(path) {
  const t = parse(path);
  if (!t) return;
  if (!/deploymentTemplate\.json#?$/.test(t.$schema ?? "")) fail(path, "$schema is not an ARM deployment template schema");
  if (!t.resources) fail(path, "no resources");
  for (const [name, p] of Object.entries(t.parameters ?? {})) {
    const type = String(p.type ?? "").toLowerCase();
    if ((type === "securestring" || type === "secureobject") && p.defaultValue !== undefined && p.defaultValue !== "" &&
        !(typeof p.defaultValue === "object" && Object.keys(p.defaultValue).length === 0)) {
      fail(path, `secure parameter "${name}" has a default value`);
    }
  }
}

function checkUi(path) {
  const ui = parse(path);
  if (!ui) return;
  if (!/CreateUIDefinition\.MultiVm\.json#?$/i.test(ui.$schema ?? "")) fail(path, "$schema is not a createUiDefinition schema");
  if (ui.handler !== "Microsoft.Azure.CreateUIDef") fail(path, 'handler must be "Microsoft.Azure.CreateUIDef"');
  if (!ui.parameters?.outputs) fail(path, "parameters.outputs is missing");
}

function checkPackageDir(dir) {
  const files = readdirSync(dir).sort();
  for (const f of files) if (!PACKAGE_FILES.includes(f)) fail(join(dir, f), "unexpected file (only azuredeploy.json and createUiDefinition.json)");
  for (const f of PACKAGE_FILES) if (!files.includes(f)) fail(dir, `missing ${f}`);
  if (files.includes("azuredeploy.json")) checkTemplate(join(dir, "azuredeploy.json"));
  if (files.includes("createUiDefinition.json")) checkUi(join(dir, "createUiDefinition.json"));
}

function checkMeta(path) {
  const m = parse(path);
  if (!m) return;
  if (typeof m.title !== "string" || !m.title.trim()) fail(path, '"title" is required');
  if (typeof m.description !== "string" || !m.description.trim()) fail(path, '"description" is required');
  if (m.requirements !== undefined && !(Array.isArray(m.requirements) && m.requirements.every((r) => typeof r === "string")))
    fail(path, '"requirements" must be a list of strings');
  for (const k of ["homepage", "marketplaceUrl"])
    if (m[k] !== undefined && !/^https:\/\//.test(m[k])) fail(path, `"${k}" must be an https URL`);
  const known = new Set(["title", "description", "requirements", "homepage", "marketplaceUrl"]);
  for (const k of Object.keys(m)) if (!known.has(k)) fail(path, `unknown key "${k}"`);
}

if (existsSync(APPS_DIR)) {
  for (const entry of readdirSync(APPS_DIR)) {
    const path = join(APPS_DIR, entry);
    if (!statSync(path).isDirectory()) {
      if (entry !== ".gitkeep") fail(path, "only app folders belong in apps/");
      continue;
    }
    if (!APP_NAME.test(entry)) fail(path, "app folder must be lowercase letters, digits and hyphens");
    if (!existsSync(join(path, "app.json"))) fail(path, "missing app.json");
    else checkMeta(join(path, "app.json"));
    for (const f of readdirSync(path)) {
      const p = join(path, f);
      if (statSync(p).isDirectory()) {
        if (f === "latest" || SEMVER.test(f)) checkPackageDir(p);
        else fail(p, 'folder must be a version (1.2.3, no "v") or latest');
      } else if (f !== "app.json" && f !== "README.md") {
        fail(p, "unexpected file");
      }
    }
    if (!listDirs(path).some((d) => SEMVER.test(d))) fail(path, "no published version");
  }
}

// Published versions are immutable: customers and Marketplace may point at them.
const baseIdx = process.argv.indexOf("--base");
if (baseIdx > 0) {
  const base = process.argv[baseIdx + 1];
  const diff = execFileSync("git", ["diff", "--name-status", "--no-renames", `${base}...HEAD`, "--", APPS_DIR], {
    encoding: "utf8",
  });
  for (const line of diff.split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t");
    const parts = path.split("/");
    if (parts.length >= 4 && SEMVER.test(parts[2]) && status !== "A") {
      fail(path, `published version changed (${status}); publish a new version instead`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `error: ${e}`).join("\n"));
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log("apps/ is valid");
