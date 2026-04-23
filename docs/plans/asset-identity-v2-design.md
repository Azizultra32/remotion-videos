# Asset Identity V2 Design

**Author**: Codex
**Date**: 2026-04-21
**Status**: Implemented and Locked
**Target**: Close Stage 1 with true rename/move-stable asset identity
**Implemented In**: `67b0f39` (`feat(assets): add v2 identity migration tooling`)

---

## Implementation Summary

Stage 1 is now locked for the stronger asset identity requirement. The implementation in `67b0f39` introduced v2 registry migration and reconcile tooling that satisfies the core guarantees:

- asset identity survives rename
- asset identity survives move
- asset identity survives unambiguous scope changes
- legacy path-hash IDs are preserved as aliases
- raw paths, legacy IDs, and canonical IDs can coexist during migration
- migration and reconcile are verified as idempotent

### Final Direction

1. Canonical asset IDs become **opaque and immutable**.
2. Current path-hash `ast_*` values become **legacy aliases**, not canonical identity.
3. `path` becomes **mutable location data**.
4. Reconcile becomes **conservative**:
   - preserve identity when the match is clear
   - mark missing instead of deleting immediately
   - refuse to auto-merge ambiguous duplicates
5. Migration becomes a **registry upgrade + timeline cutover**, not just path rewriting.

That model has now been implemented for the CLI/data migration path and verified by `scripts/verify-asset-migration.ts`.

---

## Relationship To Existing Docs

This document is the authoritative design record for the Stage 1 asset identity v2 implementation.

It supersedes the rename/move assumptions in:

- [docs/plans/asset-record-migration-plan.md](/Users/ali/remotion-videos/docs/plans/asset-record-migration-plan.md:1)

It should be read alongside:

- [docs/handoff/2026-04-21-asset-record-migration.md](/Users/ali/remotion-videos/docs/handoff/2026-04-21-asset-record-migration.md:1)
- [projects/_plans/2026-04-20-media-reactivity-architecture.md](/Users/ali/remotion-videos/projects/_plans/2026-04-20-media-reactivity-architecture.md:1)

The broader migration plan still matters for UI and workflow shape. This document narrows in on the remaining hard problem: **identity that survives rename/move without timeline churn**.

---

## Current State Snapshot

As of commit `67b0f39`, the repository has the Stage 1 v2 identity tooling in place.

### What Is Working

- `projects/<stem>/assets.json` exists as the per-project registry.
- Registry reads and writes are validated with Zod in both browser-facing and CLI paths.
- Preview and floating preview reload registry state when the registry changes.
- Runtime helper resolution can already accept either a raw path or an `ast_*` ID.
- Migration tooling upgrades v1 path-hash registries/timelines to v2 canonical opaque IDs.
- Reconcile tooling preserves identity across rename/move when the match is unambiguous.
- Missing files are preserved as `missing` records instead of being deleted.
- Duplicate-content copies receive separate records instead of being auto-merged.
- Verification scripts exist:
  - `scripts/verify-asset-library.ts`
  - `scripts/verify-asset-migration.ts`

### Historical Gap This Plan Closed

Before `67b0f39`, the identity contract was still path-derived in the implementation:

- [editor/src/types/assetRecord.ts](/Users/ali/remotion-videos/editor/src/types/assetRecord.ts:1)
  - `AssetRegistryFile.version` is still `1`
  - `AssetRecord` has no lifecycle state, no alias bridge, no path history
  - `generateAssetId(path)` still hashes the path
- [editor/src/lib/assetRecordStore.ts](/Users/ali/remotion-videos/editor/src/lib/assetRecordStore.ts:1)
  - resolver supports canonical ID or raw path only
  - no alias support
- [scripts/cli/asset-registry.ts](/Users/ali/remotion-videos/scripts/cli/asset-registry.ts:1)
  - same path-derived ID contract in Node
- [scripts/cli/migrate-timeline-assets.ts](/Users/ali/remotion-videos/scripts/cli/migrate-timeline-assets.ts:1)
  - still mints IDs from `path`
- [scripts/cli/mv-reconcile-assets.ts](/Users/ali/remotion-videos/scripts/cli/mv-reconcile-assets.ts:1)
  - still treats “new path” as “new identity”

### Consequence

The Stage 1 v2 migration/reconcile path is now coherent enough to lock. Future media technique work should not reopen this bucket unless a concrete regression reproduces against `scripts/verify-asset-migration.ts`.

---

## Historical Problem Statement

The pre-v2 system had three structural problems:

1. `generateAssetId(path)` makes identity depend on path.
   - rename => new ID
   - move => new ID
   - global/project move => new ID

2. Reconcile still reasons primarily from current path.
   - “old path missing + new path exists” becomes delete/create
   - references churn instead of being preserved

3. The transition story was incomplete.
   - some projects still contain raw path references
   - some timelines and registries contain path-hash `ast_*` IDs
   - future projects must emit opaque canonical IDs

Stage 1 closes when all three states can coexist safely while the canonical direction becomes opaque identity.

---

## Design Goals

### In Scope

- rename/move-stable identity within a project registry
- compatibility with:
  - raw path references
  - legacy path-hash `ast_*` IDs
  - new opaque `ast_*` IDs
- conservative reconcile behavior
- migration rerun idempotence
- preview/render parity
- rollback-safe migration
- sidecar/API schema enforcement for the new contract

### Out Of Scope

- cross-project dedupe
- content-addressed identity
- asset packs / import-export design
- background watchers or job workers
- automatic merge of duplicate-content files
- DAM-style metadata workflows

---

## Locked Decisions

### 1. Canonical IDs Are Opaque And Immutable

Canonical `AssetRecord.id` is generated once at record creation and never recomputed from:

- path
- scope
- stem
- content
- metadata

**Decision**: keep the `ast_` prefix for compatibility, but change the payload to opaque random hex.

Recommended format:

- `ast_<32 lowercase hex>`

Example:

- `ast_3d5c6e4d7a9c12be340f55c2aa81f7de`

Rationale:

- preserves current prefix and mental model
- clean break from path-derived 16-hex hashes
- collision margin is comfortably beyond project-scale needs

### 2. Path-Hash `ast_*` Values Become Legacy Aliases

Existing deterministic IDs are not discarded immediately.

**Decision**:

- canonical ID = opaque `id`
- legacy path-hash IDs = `aliases[]`

That allows:

- old timelines to keep rendering
- migrated timelines to be rewritten once
- old registry records to retain resolution continuity

### 3. `path` Is Mutable Location Data

`AssetRecord.path` is the current canonical file location and is allowed to change when:

- the file is renamed
- the file moves directories
- the file crosses `global`/`project` boundaries

Identity must survive the move when the match is unambiguous.

### 4. Missing Is Not Delete

Missing files should not be removed from the registry on first miss.

**Decision**:

- records move to `status = "missing"` first
- `tombstoned` is reserved for explicit delete or later GC

This preserves lineage and enables recovery.

### 5. Duplicate Content Is Ambiguous By Default

Two files with the same content are not necessarily the same asset.

**Decision**:

- content hash is a matching hint, not identity
- ambiguous duplicate matches are not auto-merged

### 6. Cross-Scope Moves Preserve Identity Only When Clear

Moving `assets/...` to `projects/<stem>/...` or the reverse should preserve identity if the system has an explicit or unambiguous match.

If it cannot distinguish move from copy, it must not guess.

---

## Current V1 Contract

The current codebase implements the following effective contract.

### Schema

```ts
type AssetRecordV1 = {
  id: `ast_${string}`;      // deterministic 16-hex hash from path
  path: string;
  kind: "image" | "video" | "gif";
  scope: "global" | "project";
  stem: string | null;
  sizeBytes: number;
  mtimeMs: number;
  createdAt: number;
  updatedAt: number;
  metadata: AssetMetadata;
  label?: string;
  tags?: string[];
  notes?: string;
};

type AssetRegistryFileV1 = {
  version: 1;
  records: AssetRecordV1[];
};
```

### Resolution Semantics

- `ast_*` resolves only by `record.id`
- raw paths pass through
- no alias bridge
- no lifecycle states
- no move lineage

### Current Benefits

- path-backed IDs are deterministic
- create/lookup by path is easy
- reusing the same path yields the same v1 ID

### Current Failure

The ID changes when the path changes, which violates the chosen Stage 1 requirement.

---

## Registry V2 Data Model

### AssetRecord

```ts
type AssetRecordV2 = {
  id: `ast_${string}`;               // canonical opaque ID
  aliases?: `ast_${string}`[];       // legacy path-hash IDs

  path: string;                      // current canonical location
  pathHistory: string[];             // previous known locations

  kind: "image" | "video" | "gif";
  scope: "global" | "project";
  stem: string | null;

  status: "active" | "missing" | "tombstoned";
  missingSince?: number | null;
  deletedAt?: number | null;

  sizeBytes: number;
  mtimeMs: number;
  createdAt: number;
  updatedAt: number;

  metadata: AssetMetadata;

  contentHash?: string | null;       // advisory only
  hashVersion?: "sha256" | null;

  label?: string;
  tags?: string[];
  notes?: string;
};
```

### Registry File

```ts
type AssetRegistryFileV2 = {
  version: 2;
  records: AssetRecordV2[];
};
```

### Required Semantics

- `id` is immutable after record creation
- `aliases` contains compatibility IDs only
- `pathHistory` is append-only lineage data
- `status` is required in v2
- `missingSince` is set when a previously active record is first observed missing
- `deletedAt` is only set on explicit delete/tombstone

### Schema Notes

- `aliases` may be omitted on fresh v2 records
- `pathHistory` should be present even if empty
- `contentHash` is optional because not every record will have it on day one
- `hashVersion` prevents silently mixing future hashing strategies

---

## Resolver Contract

One resolver contract must hold in all environments:

- editor preview
- floating preview
- runtime helper resolution
- CLI render
- migration
- reconcile

### Resolution Precedence

Given a value `v`:

1. If `v` matches a canonical `record.id`, resolve to `record.path`.
2. Else if `v` matches any `record.aliases[]`, resolve to `record.path`.
3. Else if `v` is a raw path-like string, treat it as a legacy path and pass through.
4. Else unresolved.

### Shared Rule

This precedence must be implemented consistently in:

- [editor/src/lib/assetRecordStore.ts](/Users/ali/remotion-videos/editor/src/lib/assetRecordStore.ts:1)
- [src/compositions/elements/_helpers.ts](/Users/ali/remotion-videos/src/compositions/elements/_helpers.ts:1)
- [scripts/cli/mv-render.ts](/Users/ali/remotion-videos/scripts/cli/mv-render.ts:1)

### Non-Negotiable Behavior

- canonical opaque IDs must resolve without knowing the original path
- legacy path-hash IDs must continue to resolve during the compatibility window
- raw path timelines must still work when the registry is absent
- opaque-ID timelines must fail fast when the registry is missing or corrupt

---

## Reconcile Semantics

Reconcile is the core of rename/move stability.

### Inputs

- current registry records
- current disk scan
- metadata probe
- optional content hash
- optional filesystem move hints such as `dev`/`inode`

### Matching Order

For each discovered file on disk:

1. Match active record by exact current `path`
   - update metadata
   - remain same ID

2. Else match active or missing record by `pathHistory`
   - treat as rename/move continuation
   - set current `path`
   - append previous canonical path to history if needed
   - set `status = "active"`
   - clear `missingSince`

3. Else match **exactly one** missing record by unambiguous physical signature
   - primary recommendation: `contentHash`
   - optional same-run optimization: `dev`/`inode`
   - if exactly one candidate exists:
     - preserve ID
     - update `path`, `scope`, `stem`
     - set active

4. Else if more than one plausible candidate exists:
   - emit ambiguity warning
   - do not auto-merge
   - create a new record

5. Else:
   - create new record with new opaque ID

### Missing Handling

After the disk scan:

- any previously active record not observed becomes `status = "missing"`
- set `missingSince` if not already set
- do not delete immediately

### Tombstoning

Only explicit delete should move:

- `active -> tombstoned`
- `missing -> tombstoned`

Purge/GC is optional and not required to close Stage 1.

### Move Vs Copy Policy

Preserve identity when:

- the lineage match is explicit or unambiguous
- there is exactly one viable missing predecessor
- an explicit move command can provide intent in a future pass

Create new identity when:

- more than one candidate could explain the file
- move cannot be distinguished from copy
- duplicate content exists without lineage certainty

This is intentionally conservative.

---

## Failure Handling

### Corrupt Registry

If `assets.json` is corrupt:

- do not overwrite it automatically
- fail closed for write paths
- surface a repair state
- preserve timeline data

### Missing Registry + Opaque IDs In Timeline

- fail fast with a clear error
- do not silently pass opaque IDs through to render

### Missing Registry + Raw Paths In Timeline

- continue using legacy raw-path rendering

### Mid-Migration Crash

Migration ordering must be:

1. backup timeline
2. write upgraded registry
3. write rewritten timeline
4. mark `.migrated`

That ordering preserves rollback safety and avoids timelines pointing at nonexistent canonical IDs.

### Ambiguous Move Detection

- warn
- preserve old record as missing
- create a new record rather than guessing

---

## Migration And Compatibility Strategy

### States That Must Coexist

Projects may contain:

1. raw path references
2. path-hash `ast_*` IDs
3. opaque canonical `ast_*` IDs

The system must tolerate all three during the cutover.

### Phase A: Dual-Read Plumbing

Before changing any writers:

- resolvers must support:
  - canonical ID
  - alias ID
  - raw path

No new data model should be emitted until this is true in editor, floating preview, runtime, and CLI render.

### Phase B: Registry V2 Upgrade

On loading an `assets.json` v1 registry:

- preserve the record
- mint a canonical opaque ID
- store the old path-hash ID in `aliases[]`
- initialize:
  - `version = 2`
  - `pathHistory = []`
  - `status = "active"`
  - `missingSince = null`
  - `deletedAt = null`

### Phase C: Timeline Upgrade

`migrate-timeline-assets` becomes a real v1/v2 bridge:

- raw path -> canonical opaque ID
- legacy path-hash ID -> canonical opaque ID
- canonical opaque ID -> leave unchanged

Behavior:

- backup first
- write registry first
- write timeline second
- rerunnable
- `.migrated` remains a convenience marker, not the only truth source

### Phase D: Writer Cutover

After dual-read and v2 registry support are in place:

- editor write paths emit canonical opaque IDs only
- new records are created with canonical opaque IDs only
- path-hash IDs stop being emitted by normal workflows

### Phase E: Long-Tail Compatibility

Keep reading:

- raw paths
- path-hash alias IDs

for at least one compatibility window after the cutover.

---

## Concrete File-By-File Implementation Plan

This is the first-pass implementation order that should actually be executed.

### 1. Contract And Schema

Files:

- [editor/src/types/assetRecord.ts](/Users/ali/remotion-videos/editor/src/types/assetRecord.ts:1)
- [scripts/cli/asset-registry.ts](/Users/ali/remotion-videos/scripts/cli/asset-registry.ts:1)
- [editor/src/lib/assetRecordStore.ts](/Users/ali/remotion-videos/editor/src/lib/assetRecordStore.ts:1)
- [editor/vite-plugin-sidecar.ts](/Users/ali/remotion-videos/editor/vite-plugin-sidecar.ts:1)

Tasks:

- add v2 `AssetRecord` shape and `AssetRegistryFile.version = 2`
- add Zod schema for:
  - opaque canonical IDs
  - alias IDs
  - lifecycle fields
  - path history
- add a single canonical `isAssetId()` validator that supports both:
  - old 16-hex path-hash IDs
  - new 32-hex opaque IDs
- add a new opaque ID generator
- remove any comment claiming path-derived IDs survive rename/move

Deliverable:

- schema types and validators express the true v2 contract

### 2. Shared Resolver Semantics

Files:

- [editor/src/lib/assetRecordStore.ts](/Users/ali/remotion-videos/editor/src/lib/assetRecordStore.ts:1)
- [src/compositions/elements/_helpers.ts](/Users/ali/remotion-videos/src/compositions/elements/_helpers.ts:1)
- [scripts/cli/mv-render.ts](/Users/ali/remotion-videos/scripts/cli/mv-render.ts:1)

Tasks:

- resolve by canonical ID
- resolve by alias
- fall back to raw path
- fail fast on opaque-ID timelines without a usable registry

Deliverable:

- preview, render, and migration all apply the same resolution contract

### 3. Registry Upgrade Path

Files:

- [scripts/cli/asset-registry.ts](/Users/ali/remotion-videos/scripts/cli/asset-registry.ts:1)
- [editor/src/lib/assetRecordStore.ts](/Users/ali/remotion-videos/editor/src/lib/assetRecordStore.ts:1)

Tasks:

- teach readers to load v1 and v2
- normalize v1 records into v2 in memory
- preserve legacy path-hash ID as `aliases[]`
- never silently discard corrupt registries

Deliverable:

- old registries can load under the v2 runtime without destructive rewrite

### 4. Migration Cutover

Files:

- [scripts/cli/migrate-timeline-assets.ts](/Users/ali/remotion-videos/scripts/cli/migrate-timeline-assets.ts:1)
- [scripts/verify-asset-migration.ts](/Users/ali/remotion-videos/scripts/verify-asset-migration.ts:1)

Tasks:

- detect raw path, legacy alias, and canonical ID cases
- ensure every referenced asset has a canonical v2 record
- rewrite element props to canonical opaque IDs
- write registry before timeline
- preserve backup and no-op reruns

Deliverable:

- migration is safe, idempotent, and genuinely upgrades to v2

### 5. Reconcile Rewrite

Files:

- [scripts/cli/mv-reconcile-assets.ts](/Users/ali/remotion-videos/scripts/cli/mv-reconcile-assets.ts:1)
- [scripts/cli/probe-media.ts](/Users/ali/remotion-videos/scripts/cli/probe-media.ts:1)

Tasks:

- match exact path first
- then `pathHistory`
- then unambiguous missing-record signature
- mark missing instead of immediately deleting
- add ambiguity warnings and no auto-merge rule
- keep metadata probing separate from identity

Deliverable:

- rename/move preservation happens in the registry instead of recreating assets

### 6. Editor Write Path Cutover

Files:

- [editor/src/components/AssetLibrary.tsx](/Users/ali/remotion-videos/editor/src/components/AssetLibrary.tsx:1)
- [editor/src/components/AssetPicker.tsx](/Users/ali/remotion-videos/editor/src/components/AssetPicker.tsx:1)
- [editor/src/components/Timeline.tsx](/Users/ali/remotion-videos/editor/src/components/Timeline.tsx:1)

Tasks:

- create records with canonical opaque IDs only
- stop deriving new IDs from path
- preserve usage counting across:
  - canonical IDs
  - alias IDs
  - legacy raw paths during the transition

Deliverable:

- new writes no longer deepen the v1 contract

### 7. Runtime Parity Sweep

Files:

- [src/compositions/MusicVideo.tsx](/Users/ali/remotion-videos/src/compositions/MusicVideo.tsx:1)
- [src/hooks/useFFT.ts](/Users/ali/remotion-videos/src/hooks/useFFT.ts:1)
- [src/compositions/elements/overlays/LottieClip.tsx](/Users/ali/remotion-videos/src/compositions/elements/overlays/LottieClip.tsx:1)

Tasks:

- ensure audio/image/video/lottie resolution all work through the shared contract
- ensure late-arriving registries trigger retry where needed
- ensure no render path tries to fetch `/ast_...` literally

Deliverable:

- preview and render behave the same after the cutover

---

## Verification Gates

Stage 1 closed when the gates below went green in `67b0f39`.

### Gate 1: Schema/API

Must prove:

- v2 schema enforced on GET and POST
- invalid registries rejected or surfaced cleanly
- v1 registries normalize safely

Expected checks:

- sidecar integration test coverage
- `editor/tests/assetRecordStore.test.ts`

### Gate 2: Migration Fixture

Must prove:

- raw path -> canonical opaque ID
- legacy path-hash alias -> canonical opaque ID
- multiple refs to the same asset converge on one canonical ID
- backup files are written

Expected checks:

- `npx tsx scripts/verify-asset-migration.ts`

### Gate 3: Rename/Move Stability

Must prove:

- renamed file preserves canonical ID
- moved file preserves canonical ID
- cross-scope move preserves ID when unambiguous
- ambiguous duplicate does not auto-merge

Expected checks:

- new reconcile-focused fixture suite
- explicit rename/move fixtures in `verify-asset-migration`

### Gate 4: Idempotence

Must prove:

- second migration run is a no-op
- second reconcile run is a no-op when disk has not changed

### Gate 5: Preview/Render Parity

Must prove:

- preview resolves canonical IDs
- floating preview resolves canonical IDs
- render CLI resolves canonical IDs
- no unresolved-ID warnings in the green path

Expected checks:

- `scripts/verify-asset-library.ts`
- element render coverage
- CLI render smoke path

### Gate 6: Rollback Safety

Must prove:

- timeline backup exists
- failed migration can restore previous state
- registry corruption does not cause silent destructive rewrite

---

## Acceptance Criteria

Stage 1 is done because all of the following are true for the v2 migration/reconcile path:

- canonical IDs are opaque and immutable
- path-hash IDs are compatibility aliases only
- current path is mutable and preserved across rename/move
- missing assets are not immediately deleted
- preview and render both resolve old and new references
- migration and reconcile are idempotent
- rename/move preservation is proven by automated checks

If any of those regress, reopen this as a bug against the verifier rather than restarting the design.

---

## Implemented Execution Order

This is the execution order that landed in `67b0f39`.

1. Lock v2 schema and ID validators.
2. Add shared dual-read resolver semantics with alias support.
3. Add canonical opaque ID generation.
4. Upgrade registry read/write paths to v1/v2 handling.
5. Refactor migration CLI into a real v1 -> v2 bridge.
6. Refactor reconcile to preserve identity conservatively.
7. Switch editor write paths to canonical opaque IDs only.
8. Expand verification for rename, move, cross-scope move, idempotence, and rollback.
9. Closed Stage 1 by passing `scripts/verify-asset-migration.ts`.

---

## Implementation Risks

### Risk: Over-Aggressive Auto-Matching

If reconcile overuses content hash as identity, copied files will collapse incorrectly.

Mitigation:

- treat hash as advisory only
- require singular, unambiguous candidate

### Risk: Silent Partial Upgrade

If the runtime can read opaque IDs before all environments share alias resolution, preview and render will diverge.

Mitigation:

- dual-read plumbing before writer cutover

### Risk: Corrupt Registry Rewrite

If a broken registry is “fixed” by writing normalized garbage back, recovery becomes harder.

Mitigation:

- fail closed
- never overwrite invalid registries automatically

### Risk: Timeline/Registry Drift During Migration

If timeline writes happen before registry writes, canonical IDs may point at nonexistent records.

Mitigation:

- always write registry before timeline
- keep backups

---

## Final Call

For the stronger Stage 1 requirement you chose, the blocker is no longer open.

The implemented answer is:

**Implement registry v2 with opaque canonical IDs, alias-backed compatibility for legacy path-hash IDs, and conservative identity-preserving reconcile, then prove it with rename/move/idempotence verification.**

That landed in `67b0f39`. Do not reopen Stage 1 unless the verifier fails or a user-visible regression is traced to this identity contract.
