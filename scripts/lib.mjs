// Shared helpers for generate.mjs and validate.mjs. Node 20+, no dependencies.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const REPO = process.env.OFFER_REPO ?? "linkcode-labs/deploy-offer-to-azure";
export const BRANCH = process.env.OFFER_BRANCH ?? "main";
export const APPS_DIR = "apps";
export const PACKAGE_FILES = ["azuredeploy.json", "createUiDefinition.json"];
export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
// Semantic version without a leading "v" (release tag v1.2.3 is published as 1.2.3).
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listDirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();
}

function compareIdentifiers(a, b) {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareSemver(a, b) {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d;
  }
  if (!ma[4] && !mb[4]) return 0;
  if (!ma[4]) return 1; // release > prerelease
  if (!mb[4]) return -1;
  const pa = ma[4].split(".");
  const pb = mb[4].split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const d = compareIdentifiers(pa[i], pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

export function isPrerelease(version) {
  return Boolean(SEMVER.exec(version)?.[4]);
}

/** Versions of an app, newest first. */
export function versionsOf(appDir) {
  return listDirs(appDir)
    .filter((d) => SEMVER.test(d))
    .sort(compareSemver)
    .reverse();
}

/** The version copied to latest/: newest stable, or newest prerelease if there is no stable one. */
export function latestOf(versions) {
  return versions.find((v) => !isPrerelease(v)) ?? versions[0];
}

export function rawUrl(path) {
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
}

export function deployUrl(dir) {
  const template = encodeURIComponent(rawUrl(`${dir}/azuredeploy.json`));
  const ui = encodeURIComponent(rawUrl(`${dir}/createUiDefinition.json`));
  return `https://portal.azure.com/#create/Microsoft.Template/uri/${template}/createUIDefinitionUri/${ui}`;
}

export const BUTTON_IMAGE = "https://aka.ms/deploytoazurebutton";
