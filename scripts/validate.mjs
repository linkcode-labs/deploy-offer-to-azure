#!/usr/bin/env node
// Checks the apps/ tree. Everything here is public, so this is the last gate before customers.
//
// Usage: node scripts/validate.mjs                 check the working tree
//        node scripts/validate.mjs --base <ref>    also check that published versions were not changed
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  APP_NAME,
  APPS_DIR,
  MEDIA_DIR,
  MEDIA_EXT,
  MEDIA_MAX_BYTES,
  MERMAID_TYPES,
  PACKAGE_FILES,
  SEMVER,
  VERSION_OPTIONAL_FILES,
  listDirs,
  mermaidHeader,
} from "./lib.mjs";

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
    if (!p.metadata?.description) fail(path, `parameter "${name}" has no metadata.description (@description in Bicep)`);
  }
  for (const [name, o] of Object.entries(t.outputs ?? {})) {
    if (!o.metadata?.description) fail(path, `output "${name}" has no metadata.description (@description in Bicep)`);
  }
}

function checkUi(path) {
  const ui = parse(path);
  if (!ui) return;
  if (!/CreateUIDefinition\.MultiVm\.json#?$/i.test(ui.$schema ?? "")) fail(path, "$schema is not a createUiDefinition schema");
  if (ui.handler !== "Microsoft.Azure.CreateUIDef") fail(path, 'handler must be "Microsoft.Azure.CreateUIDef"');
  if (!ui.parameters?.outputs) fail(path, "parameters.outputs is missing");
}

function checkPackageDir(dir, optional = []) {
  const files = readdirSync(dir).sort();
  for (const f of files)
    if (!PACKAGE_FILES.includes(f) && !optional.includes(f))
      fail(join(dir, f), `unexpected file (allowed: ${[...PACKAGE_FILES, ...optional].join(", ")})`);
  for (const f of PACKAGE_FILES) if (!files.includes(f)) fail(dir, `missing ${f}`);
  if (files.includes("azuredeploy.json")) checkTemplate(join(dir, "azuredeploy.json"));
  if (files.includes("createUiDefinition.json")) checkUi(join(dir, "createUiDefinition.json"));
}

const str = (v) => typeof v === "string" && v.trim().length > 0;
const strList = (v) => Array.isArray(v) && v.length > 0 && v.every(str);

function checkMeta(appDir) {
  const path = join(appDir, "app.json");
  const m = parse(path);
  if (!m) return;
  const req = (key, ok, what) => {
    if (!ok(m[key])) fail(path, `"${key}" ${what}`);
  };
  req("title", str, "is required");
  req("summary", (v) => str(v) && v.length <= 160 && !v.includes("\n"), "is required: one line, up to 160 characters");
  req("description", str, "is required");
  req("features", strList, "is required: a non-empty list of strings");
  req("requirements", strList, "is required: a non-empty list of strings");
  req("cost", str, "is required");
  req("security", str, "is required");

  const a = m.architecture;
  if (!a || !str(a.description)) fail(path, '"architecture.description" is required');
  if (!Array.isArray(a?.resources) || !a.resources.length) fail(path, '"architecture.resources" is required: a non-empty list');
  for (const [i, r] of (a?.resources ?? []).entries()) {
    if (!str(r.name) || !str(r.purpose)) fail(path, `architecture.resources[${i}] needs "name" and "purpose"`);
    if (!/^Microsoft\.[A-Za-z]+\/[A-Za-z/]+$/.test(r.type ?? "")) fail(path, `architecture.resources[${i}].type must be an Azure resource type like Microsoft.App/containerApps`);
    for (const k of Object.keys(r)) if (!["name", "type", "purpose", "sku"].includes(k)) fail(path, `architecture.resources[${i}]: unknown key "${k}"`);
  }
  for (const k of Object.keys(a ?? {})) if (!["description", "resources"].includes(k)) fail(path, `architecture: unknown key "${k}"`);

  if (m.afterDeployment !== undefined && !strList(m.afterDeployment)) fail(path, '"afterDeployment" must be a list of strings');
  for (const [i, sh] of (m.screenshots ?? []).entries()) {
    if (!str(sh.caption)) fail(path, `screenshots[${i}].caption is required`);
    if (!new RegExp(`^${MEDIA_DIR}/[\\w.-]+$`).test(sh.file ?? "") || !existsSync(join(appDir, sh.file ?? "")))
      fail(path, `screenshots[${i}].file must be an existing file in ${MEDIA_DIR}/`);
  }
  const support = m.support ?? {};
  for (const k of Object.keys(support)) {
    if (!["homepage", "docs", "marketplaceUrl", "contact"].includes(k)) fail(path, `support: unknown key "${k}"`);
    else if (k === "contact" ? !/^(https:\/\/|mailto:)/.test(support[k]) : !/^https:\/\//.test(support[k]))
      fail(path, `support.${k} must be an https URL${k === "contact" ? " or mailto:" : ""}`);
  }
  const known = ["title", "summary", "description", "features", "screenshots", "architecture", "requirements", "cost", "security", "afterDeployment", "support"];
  for (const k of Object.keys(m)) if (!known.includes(k)) fail(path, `unknown key "${k}" (see docs/app-page-standard.md)`);
}

function checkDiagram(path) {
  const text = readFileSync(path, "utf8");
  if (!MERMAID_TYPES.test(mermaidHeader(text))) fail(path, "must be a Mermaid diagram starting with flowchart (recommended), graph, architecture-beta or C4*");
  if (text.includes("```")) fail(path, "write the Mermaid source only, without ``` fences");
}

function checkMedia(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory() || !MEDIA_EXT.test(f)) fail(p, "media/ holds only png, jpg, svg, gif or webp files");
    else if (statSync(p).size > MEDIA_MAX_BYTES) fail(p, "larger than 1 MB");
  }
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
    else checkMeta(path);
    if (!existsSync(join(path, "architecture.mmd"))) fail(path, "missing architecture.mmd");
    else checkDiagram(join(path, "architecture.mmd"));
    for (const f of readdirSync(path)) {
      const p = join(path, f);
      if (statSync(p).isDirectory()) {
        if (f === "latest") checkPackageDir(p);
        else if (SEMVER.test(f)) checkPackageDir(p, VERSION_OPTIONAL_FILES);
        else if (f === MEDIA_DIR) checkMedia(p);
        else fail(p, `folder must be a version (1.2.3, no "v"), latest or ${MEDIA_DIR}`);
      } else if (!["app.json", "architecture.mmd", "README.md"].includes(f)) {
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
