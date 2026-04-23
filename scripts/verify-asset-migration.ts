#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { generateAssetId } from "../editor/src/types/assetRecord";
import { resolveProjectsDir } from "./cli/paths";

const repoRoot = resolve(__dirname, "..");
const projectsDir = resolveProjectsDir(repoRoot);
const stem = "__verify-asset-migration";
const projectDir = join(projectsDir, stem);
const timelinePath = join(projectDir, "timeline.json");
const assetsPath = join(projectDir, "assets.json");
const migratedFlagPath = join(projectDir, ".migrated");

const primaryGlobalRel = "assets/images/__verify_identity_primary.svg";
const primaryGlobalPath = join(repoRoot, "public", primaryGlobalRel);
const primaryRenamedGlobalRel = "assets/images/__verify_identity_primary-renamed.svg";
const primaryRenamedGlobalPath = join(repoRoot, "public", primaryRenamedGlobalRel);
const primaryProjectRel = `projects/${stem}/images/__verify_identity_primary-renamed.svg`;
const primaryProjectPath = join(projectsDir, stem, "images", "__verify_identity_primary-renamed.svg");

const secondaryGlobalRel = "assets/images/__verify_identity_secondary.svg";
const secondaryGlobalPath = join(repoRoot, "public", secondaryGlobalRel);
const secondaryProjectRel = `projects/${stem}/images/__verify_identity_secondary-copy.svg`;
const secondaryProjectPath = join(projectsDir, stem, "images", "__verify_identity_secondary-copy.svg");

const PRIMARY_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="23" height="17" viewBox="0 0 23 17">
  <rect width="23" height="17" fill="#d43b3b"/>
  <circle cx="6" cy="6" r="3" fill="#fff3d1"/>
  <text x="11" y="13" font-size="4" fill="#111111">P1</text>
</svg>
`;

const SECONDARY_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="19" height="21" viewBox="0 0 19 21">
  <rect width="19" height="21" fill="#2d5fd4"/>
  <path d="M2 18 L9 3 L17 18 Z" fill="#d8ff8a"/>
  <text x="5" y="19" font-size="4" fill="#101820">D2</text>
</svg>
`;

type RegistryFile = {
  version: number;
  records: any[];
};

const fail = (message: string): never => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

const ok = (message: string): void => {
  console.log(`OK   ${message}`);
};

const cleanup = (): void => {
  rmSync(projectDir, { recursive: true, force: true });
  for (const dir of [join(repoRoot, "public", "assets", "images")]) {
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith("__verify_") || name.startsWith("__debug_") || name.startsWith("debug")) {
          rmSync(join(dir, name), { force: true });
        }
      }
    } catch {
      // ignore missing folders
    }
  }
  rmSync(primaryGlobalPath, { force: true });
  rmSync(primaryRenamedGlobalPath, { force: true });
  rmSync(primaryProjectPath, { force: true });
  rmSync(secondaryGlobalPath, { force: true });
  rmSync(secondaryProjectPath, { force: true });
};

const runScript = (
  script: string,
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync("npx", ["tsx", script, "--project", stem], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MV_PROJECTS_DIR: projectsDir,
      ...extraEnv,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const readRegistry = (): RegistryFile => JSON.parse(readFileSync(assetsPath, "utf8")) as RegistryFile;

const readTimeline = (): { elements: Array<{ id: string; props: Record<string, unknown> }>; _migrated?: boolean } =>
  JSON.parse(readFileSync(timelinePath, "utf8")) as {
    elements: Array<{ id: string; props: Record<string, unknown> }>;
    _migrated?: boolean;
  };

const findById = (registry: RegistryFile, id: string): any | null =>
  registry.records.find((record) => record.id === id) ?? null;

const findByPath = (registry: RegistryFile, path: string): any | null =>
  registry.records.find((record) => record.path === path) ?? null;

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const next = canonicalizeJson(input[key]);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalizeJson(value));

const makeNoisyV2Registry = (registry: RegistryFile): RegistryFile => ({
  version: 2,
  records: registry.records.map((record) => {
    const next: Record<string, unknown> = {
      metadata: Object.fromEntries(Object.entries((record.metadata ?? {}) as Record<string, unknown>).reverse()),
      updatedAt: record.updatedAt,
      id: record.id,
      aliases: record.aliases,
      path: record.path,
      pathHistory: record.pathHistory,
      kind: record.kind,
      scope: record.scope,
      stem: record.stem,
      status: record.status,
      missingSince: record.status === "missing" ? record.missingSince : undefined,
      deletedAt: record.status === "tombstoned" ? record.deletedAt : undefined,
      sizeBytes: record.sizeBytes,
      mtimeMs: record.mtimeMs,
      createdAt: record.createdAt,
      contentHash: record.contentHash,
      hashVersion: record.hashVersion,
      label: record.label,
      tags: record.tags,
      notes: record.notes,
    };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete next[key];
    }
    return next;
  }),
});

const findElement = (
  timeline: { elements: Array<{ id?: string; props: Record<string, unknown> }> },
  id: string,
): { id?: string; props: Record<string, unknown> } => {
  const element = timeline.elements.find((entry) => entry.id === id);
  if (!element) fail(`timeline element not found: ${id}`);
  return element;
};

cleanup();

try {
  mkdirSync(join(repoRoot, "public", "assets", "images"), { recursive: true });
  mkdirSync(join(projectsDir, stem, "images"), { recursive: true });

  writeFileSync(primaryGlobalPath, PRIMARY_SVG);
  ok("seeded primary SVG in public/assets/images/");

  const legacyId = generateAssetId(primaryGlobalRel);
  const seededRegistry: RegistryFile = {
    version: 1,
    records: [
      {
        id: legacyId,
        path: primaryGlobalRel,
        kind: "image",
        scope: "global",
        stem: null,
        sizeBytes: Buffer.byteLength(PRIMARY_SVG),
        mtimeMs: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
        label: basename(primaryGlobalRel),
      },
    ],
  };
  writeFileSync(assetsPath, `${JSON.stringify(seededRegistry, null, 2)}\n`);

  writeFileSync(
    timelinePath,
    JSON.stringify(
      {
        version: 1,
        stem,
        fps: 24,
        compositionDuration: 4,
        elements: [
          {
            id: "el-raw-path",
            type: "overlay.staticImage",
            trackIndex: 0,
            startSec: 0,
            durationSec: 2,
            label: "Raw Path",
            props: {
              imageSrc: primaryGlobalRel,
              x: 50,
              y: 50,
              widthPct: 50,
              heightPct: 50,
              fit: "contain",
              opacity: 1,
              fadeInSec: 0,
              fadeOutSec: 0,
            },
          },
          {
            id: "el-legacy-id",
            type: "overlay.staticImage",
            trackIndex: 1,
            startSec: 0,
            durationSec: 2,
            label: "Legacy ID",
            props: {
              imageSrc: legacyId,
              x: 10,
              y: 10,
              widthPct: 25,
              heightPct: 25,
              fit: "cover",
              opacity: 1,
              fadeInSec: 0,
              fadeOutSec: 0,
            },
          },
          {
            id: "el-undeclared-prop",
            type: "overlay.staticImage",
            trackIndex: 2,
            startSec: 0,
            durationSec: 2,
            label: "Undeclared Prop",
            props: {
              imageSrc: primaryGlobalRel,
              backgroundImage: primaryGlobalRel,
              x: 20,
              y: 20,
              widthPct: 30,
              heightPct: 30,
              fit: "contain",
              opacity: 1,
              fadeInSec: 0,
              fadeOutSec: 0,
            },
          },
          {
            id: "el-lottie-json",
            type: "overlay.lottie",
            trackIndex: 3,
            startSec: 0,
            durationSec: 2,
            label: "Lottie JSON",
            props: {
              jsonSrc: primaryGlobalRel,
              x: 50,
              y: 50,
              widthPct: 50,
              heightPct: 50,
              playbackRate: 1,
              loop: true,
              direction: "forward",
              fadeInSec: 0,
              fadeOutSec: 0,
            },
          },
        ],
      },
      null,
      2,
    ),
  );
  ok("wrote fixture timeline.json with raw path + legacy ID");

  const migrate1 = runScript("scripts/cli/migrate-timeline-assets.ts");
  if (migrate1.status !== 0) {
    fail(`migrate command failed:\n${migrate1.stdout}\n${migrate1.stderr}`);
  }
  ok("migration CLI completed successfully");

  if (!existsSync(assetsPath)) fail("assets.json was not created");
  if (!existsSync(migratedFlagPath)) fail(".migrated flag was not created");

  const registryAfterMigrate = readRegistry();
  if (registryAfterMigrate.version !== 2) fail(`expected registry version 2, got ${registryAfterMigrate.version}`);
  if (registryAfterMigrate.records.length !== 1) {
    fail(`expected 1 asset record after migration, got ${registryAfterMigrate.records.length}`);
  }

  const migratedRecord = registryAfterMigrate.records[0]!;
  const canonicalId = String(migratedRecord.id);
  if (!/^ast_[0-9a-f]{32}$/.test(canonicalId)) {
    fail(`migration did not mint opaque canonical id: ${canonicalId}`);
  }
  if (migratedRecord.path !== primaryGlobalRel) {
    fail(`migrated record path mismatch: ${String(migratedRecord.path)}`);
  }
  if (migratedRecord.status !== "active") fail(`expected active status, got ${String(migratedRecord.status)}`);
  if (!Array.isArray(migratedRecord.aliases) || !migratedRecord.aliases.includes(legacyId)) {
    fail("legacy path-hash id was not preserved as an alias");
  }
  if (!Array.isArray(migratedRecord.pathHistory) || migratedRecord.pathHistory.length !== 0) {
    fail("fresh v2 record should start with empty pathHistory");
  }

  const migratedTimeline = readTimeline();
  const rawPathElement = findElement(migratedTimeline, "el-raw-path");
  const legacyElement = findElement(migratedTimeline, "el-legacy-id");
  const undeclaredPropElement = findElement(migratedTimeline, "el-undeclared-prop");
  const lottieElement = findElement(migratedTimeline, "el-lottie-json");
  if (rawPathElement.props.imageSrc !== canonicalId || legacyElement.props.imageSrc !== canonicalId) {
    fail(
      `declared media refs were not rewritten to the canonical opaque id: ${String(
        rawPathElement.props.imageSrc,
      )}, ${String(legacyElement.props.imageSrc)}`,
    );
  }
  if (undeclaredPropElement.props.imageSrc !== canonicalId) {
    fail(`declared staticImage imageSrc was not rewritten: ${String(undeclaredPropElement.props.imageSrc)}`);
  }
  if (undeclaredPropElement.props.backgroundImage !== primaryGlobalRel) {
    fail(`undeclared backgroundImage should remain untouched: ${String(undeclaredPropElement.props.backgroundImage)}`);
  }
  if (lottieElement.props.jsonSrc !== primaryGlobalRel) {
    fail(`overlay.lottie jsonSrc should remain untouched without mediaFields: ${String(lottieElement.props.jsonSrc)}`);
  }
  if (migratedTimeline._migrated !== true) {
    fail("timeline.json missing _migrated flag");
  }
  ok("timeline.json rewrote only declared media fields and left undeclared props untouched");

  const backupFiles = readdirSync(projectDir).filter((name) => name.startsWith("timeline.backup-"));
  if (backupFiles.length === 0) fail("migration did not create a timeline backup");
  ok("migration created a timeline backup");

  const registrySnapshot = readFileSync(assetsPath, "utf8");
  const timelineSnapshot = readFileSync(timelinePath, "utf8");
  const migrate2 = runScript("scripts/cli/migrate-timeline-assets.ts");
  if (migrate2.status !== 0) {
    fail(`second migrate command failed:\n${migrate2.stdout}\n${migrate2.stderr}`);
  }
  if (readFileSync(assetsPath, "utf8") !== registrySnapshot) {
    fail("second migration run changed assets.json");
  }
  if (readFileSync(timelinePath, "utf8") !== timelineSnapshot) {
    fail("second migration run changed timeline.json");
  }
  ok("second migration run was a no-op");

  renameSync(primaryGlobalPath, primaryRenamedGlobalPath);
  const reconcile1 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile1.status !== 0) {
    fail(`rename reconcile failed:\n${reconcile1.stdout}\n${reconcile1.stderr}`);
  }
  const registryAfterRename = readRegistry();
  const renamedRecord = findById(registryAfterRename, canonicalId);
  if (!renamedRecord) fail("canonical asset record disappeared after rename");
  if (renamedRecord.path !== primaryRenamedGlobalRel) {
    fail(`rename did not update record path: ${String(renamedRecord.path)}`);
  }
  if (renamedRecord.status !== "active") fail("renamed record should remain active");
  if (!Array.isArray(renamedRecord.pathHistory) || !renamedRecord.pathHistory.includes(primaryGlobalRel)) {
    fail("rename did not preserve prior path in pathHistory");
  }
  ok("rename preserved identity and appended pathHistory");

  renameSync(primaryRenamedGlobalPath, primaryProjectPath);
  const reconcile2 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile2.status !== 0) {
    fail(`cross-scope reconcile failed:\n${reconcile2.stdout}\n${reconcile2.stderr}`);
  }
  const registryAfterMove = readRegistry();
  const movedRecord = findById(registryAfterMove, canonicalId);
  if (!movedRecord) fail("canonical asset record disappeared after cross-scope move");
  if (movedRecord.path !== primaryProjectRel) {
    fail(`cross-scope move did not update record path: ${String(movedRecord.path)}`);
  }
  if (movedRecord.scope !== "project" || movedRecord.stem !== stem) {
    fail(`cross-scope move did not update scope/stem: ${JSON.stringify({ scope: movedRecord.scope, stem: movedRecord.stem })}`);
  }
  if (!Array.isArray(movedRecord.pathHistory) || !movedRecord.pathHistory.includes(primaryRenamedGlobalRel)) {
    fail("cross-scope move did not append previous path");
  }
  ok("cross-scope move preserved the same canonical id");

  rmSync(primaryProjectPath, { force: true });
  const reconcile3 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile3.status !== 0) {
    fail(`missing-file reconcile failed:\n${reconcile3.stdout}\n${reconcile3.stderr}`);
  }
  const registryAfterMissing = readRegistry();
  const missingRecord = findById(registryAfterMissing, canonicalId);
  if (!missingRecord) fail("missing record was deleted instead of preserved");
  if (missingRecord.status !== "missing") {
    fail(`missing file was not marked missing: ${String(missingRecord.status)}`);
  }
  if (typeof missingRecord.missingSince !== "number") {
    fail("missing file did not record missingSince");
  }
  ok("missing file was preserved as a missing record");

  writeFileSync(secondaryGlobalPath, SECONDARY_SVG);
  const reconcile4 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile4.status !== 0) {
    fail(`secondary asset reconcile failed:\n${reconcile4.stdout}\n${reconcile4.stderr}`);
  }
  const registryAfterSecondary = readRegistry();
  const secondaryOriginal = findByPath(registryAfterSecondary, secondaryGlobalRel);
  if (!secondaryOriginal) fail("secondary asset was not added");
  if (!/^ast_[0-9a-f]{32}$/.test(String(secondaryOriginal.id))) {
    fail(`secondary asset did not receive an opaque id: ${String(secondaryOriginal.id)}`);
  }
  ok("new disk asset was added with a canonical opaque id");

  copyFileSync(secondaryGlobalPath, secondaryProjectPath);
  const reconcile5 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile5.status !== 0) {
    fail(`duplicate-content reconcile failed:\n${reconcile5.stdout}\n${reconcile5.stderr}`);
  }
  const registryAfterDuplicate = readRegistry();
  const duplicateOriginal = findByPath(registryAfterDuplicate, secondaryGlobalRel);
  const duplicateCopy = findByPath(registryAfterDuplicate, secondaryProjectRel);
  if (!duplicateOriginal || !duplicateCopy) fail("duplicate-content test did not leave both records present");
  if (duplicateOriginal.id === duplicateCopy.id) {
    fail("duplicate-content copy was auto-merged instead of receiving a new record");
  }
  ok("duplicate content produced a separate record instead of auto-merging");

  const legacyUpgradeRegistry = {
    version: 1,
    records: registryAfterDuplicate.records,
  };
  writeFileSync(assetsPath, `${JSON.stringify(legacyUpgradeRegistry, null, 2)}\n`);
  const legacyUpgradeSnapshot = readFileSync(assetsPath, "utf8");
  const reconcileLegacyUpgrade = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcileLegacyUpgrade.status !== 0) {
    fail(`legacy upgrade reconcile failed:\n${reconcileLegacyUpgrade.stdout}\n${reconcileLegacyUpgrade.stderr}`);
  }
  if (!reconcileLegacyUpgrade.stdout.includes("assets.json updated")) {
    fail(`legacy upgrade reconcile did not report an update:\n${reconcileLegacyUpgrade.stdout}`);
  }
  if (readFileSync(assetsPath, "utf8") === legacyUpgradeSnapshot) {
    fail("legacy v1 reconcile did not rewrite assets.json");
  }
  const registryAfterLegacyUpgrade = readRegistry();
  if (registryAfterLegacyUpgrade.version !== 2) fail("legacy reconcile did not upgrade registry to v2");
  if (!findById(registryAfterLegacyUpgrade, canonicalId)) {
    fail("legacy reconcile did not preserve canonical identity");
  }
  if (stableJson(registryAfterLegacyUpgrade) !== stableJson(registryAfterDuplicate)) {
    fail("legacy reconcile changed registry semantics during v2 rewrite");
  }
  ok("legacy v1 reconcile still rewrites to canonical v2");

  const v2NoOpRegistry = makeNoisyV2Registry(registryAfterLegacyUpgrade);
  const v2NoOpSnapshot = `${JSON.stringify(v2NoOpRegistry, null, 2)}\n`;
  writeFileSync(assetsPath, v2NoOpSnapshot);
  const reconcileNoOpV2 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcileNoOpV2.status !== 0) {
    fail(`v2 no-op reconcile failed:\n${reconcileNoOpV2.stdout}\n${reconcileNoOpV2.stderr}`);
  }
  if (!reconcileNoOpV2.stdout.includes("registry is in sync")) {
    fail(`v2 no-op reconcile did not report sync:\n${reconcileNoOpV2.stdout}`);
  }
  if (readFileSync(assetsPath, "utf8") !== v2NoOpSnapshot) {
    fail("semantically unchanged v2 reconcile rewrote assets.json");
  }
  ok("semantically unchanged v2 reconcile did not rewrite assets.json");

  const duplicateSnapshot = readFileSync(assetsPath, "utf8");
  const reconcile6 = runScript("scripts/cli/mv-reconcile-assets.ts");
  if (reconcile6.status !== 0) {
    fail(`idempotence reconcile failed:\n${reconcile6.stdout}\n${reconcile6.stderr}`);
  }
  if (readFileSync(assetsPath, "utf8") !== duplicateSnapshot) {
    fail("second reconcile run changed assets.json");
  }
  ok("second reconcile run was a no-op");

  console.log("\nverify-asset-migration: ALL CHECKS PASSED");
} finally {
  cleanup();
}
