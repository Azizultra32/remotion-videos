# Asset Record Migration Plan

**Author**: Claude Sonnet 4.5  
**Date**: 2026-04-21  
**Status**: Planning Phase  
**Target**: Replace raw path strings in element props with stable asset IDs backed by AssetRecord persistence

---

## Executive Summary

**Current Problem**: Element props reference media assets via raw path strings (`imageSrc: "assets/logo.png"`). When users rename files, move assets between scopes (global ↔ project), or reorganize folders, timeline elements break silently. Metadata (dimensions, duration, alpha channel) must be re-scanned on every render.

**Target State**: Element props store stable asset IDs (`imageSrc: "ast_a1b2c3d4"`). A new `projects/<stem>/assets.json` file persists `AssetRecord[]` entries that map IDs to paths + metadata. The sidecar resolves IDs → paths at render time. File renames update the record's path field without touching timeline elements.

**Key Benefits**:
- Asset renames/moves don't break timelines
- Metadata (width, height, duration, hasAlpha) cached once per asset, not scanned per render
- Foundation for asset packs, templates, and cross-project asset reuse
- Tags/labels for organization
- Stable preview/poster/thumbnail URLs via asset ID

---

## 1. Migration Strategy

### Backward Compatibility Approach

**Dual-Mode Resolution**: The renderer will accept both legacy path strings and new asset IDs during a transition period. The resolver function checks the value format:

```typescript
function resolveAssetSrc(value: string): string {
  if (value.startsWith('ast_')) {
    // Asset ID → lookup in AssetRecord[]
    const record = assetRegistry.get(value);
    return record?.path ?? value; // fallback to ID if not found
  }
  // Legacy path string → pass through
  return value;
}
```

**Migration Path**: Existing projects get an automatic migration on first editor load after the update. The migration:
1. Scans all timeline elements for media field values (imageSrc, videoSrc, gifSrc, imageSrcs array)
2. Creates an AssetRecord for each unique path
3. Replaces path strings with generated asset IDs
4. Writes `assets.json` + updated `timeline.json`
5. Sets a `_migrated: true` flag in `timeline.json` to prevent re-migration

**Rollback Safety**: Legacy path strings continue to work post-migration. If a user downgrades to a pre-migration editor version, paths in timeline.json will be asset IDs but the render will fail gracefully (missing image) rather than crash. A recovery script can reverse the migration.

---

## 2. Data Model Changes

### AssetRecord Schema

```typescript
// editor/src/types/assets.ts (augment existing types)

export type AssetRecord = {
  id: string;                    // "ast_" + nanoid(12)
  path: string;                  // "assets/images/logo.png" or "projects/dubfire/images/kick.png"
  kind: AssetKind;               // "image" | "video" | "gif"
  scope: AssetScope;             // "global" | "project"
  stem: string | null;           // project stem when scope=project
  filename: string;              // "logo.png"
  basename: string;              // "logo"
  extension: string;             // "png"
  size: number;                  // bytes
  mtime: number;                 // Unix timestamp ms
  addedAt: number;               // Unix timestamp ms when record was created
  
  // Cached metadata (set once on import/scan, not re-scanned)
  metadata: AssetMetadata;
  
  // User-facing organization
  label?: string;                // override filename for display
  tags?: string[];               // ["background", "intro", "zeta"]
  notes?: string;                // free-form description
};

export type AssetMetadata = {
  width?: number;                // image/video natural width
  height?: number;               // image/video natural height
  durationSec?: number;          // video/gif duration
  hasAlpha?: boolean;            // PNG/WEBP alpha channel detection
  fps?: number;                  // video framerate
  codec?: string;                // video codec (h264, vp9, etc)
};
```

### projects/<stem>/assets.json Format

```json
{
  "version": 1,
  "records": [
    {
      "id": "ast_x7k2m9p4n8q1",
      "path": "assets/images/logo.png",
      "kind": "image",
      "scope": "global",
      "stem": null,
      "filename": "logo.png",
      "basename": "logo",
      "extension": "png",
      "size": 45821,
      "mtime": 1713712345678,
      "addedAt": 1713712345678,
      "metadata": {
        "width": 1920,
        "height": 1080,
        "hasAlpha": true
      },
      "tags": ["branding", "intro"]
    },
    {
      "id": "ast_b3n7r1k5m2q8",
      "path": "projects/dubfire/videos/kick-loop.mp4",
      "kind": "video",
      "scope": "project",
      "stem": "dubfire",
      "filename": "kick-loop.mp4",
      "basename": "kick-loop",
      "extension": "mp4",
      "size": 2845912,
      "mtime": 1713712456789,
      "addedAt": 1713712456789,
      "metadata": {
        "width": 1920,
        "height": 1080,
        "durationSec": 4.2,
        "fps": 30,
        "codec": "h264"
      },
      "label": "Kick Drum Loop",
      "tags": ["drums", "intro"]
    }
  ]
}
```

**Global vs Project Assets**: The `assets.json` file is per-project. Global-scope assets (in `public/assets/`) appear in every project's `assets.json` with `scope: "global"`. This allows per-project tags/labels for the same global asset without polluting a shared registry.

### Timeline Element Reference Changes

**Before** (raw path string):
```json
{
  "id": "el-123",
  "type": "overlay.staticImage",
  "props": {
    "imageSrc": "assets/images/logo.png"
  }
}
```

**After** (asset ID):
```json
{
  "id": "el-123",
  "type": "overlay.staticImage",
  "props": {
    "imageSrc": "ast_x7k2m9p4n8q1"
  }
}
```

**Multi-value fields** (e.g., BeatImageCycle's `imageSrcs: string[]`):
```json
{
  "id": "el-456",
  "type": "overlay.beatImageCycle",
  "props": {
    "imageSrcs": ["ast_x7k2m9p4n8q1", "ast_b3n7r1k5m2q8"]
  }
}
```

---

## 3. Implementation Phases

### Phase 1: Core Infrastructure (2-3 tasks)

**Task 1.1: AssetRecord Type + Storage**
- **Scope**: Define `AssetRecord` type in `editor/src/types/assets.ts`
- **Files Touched**:
  - `editor/src/types/assets.ts` — add AssetRecord, AssetMetadata types
  - `editor/sidecar.ts` — add `/api/assets/registry/:stem` GET/POST endpoints
  - Create `scripts/cli/asset-registry.ts` — read/write `projects/<stem>/assets.json`
- **Verification**:
  - `curl http://localhost:3210/api/assets/registry/dubfire` returns `{ records: [] }`
  - Write a test record via POST, reload via GET, confirm persistence

**Task 1.2: Metadata Scanner**
- **Scope**: Build a metadata extraction utility for images/videos/gifs
- **Files Touched**:
  - Create `editor/src/utils/assetMetadata.ts` — extract width/height/duration/alpha/fps/codec
  - Use browser APIs (`Image`, `HTMLVideoElement.loadedmetadata`) for client-side scanning
  - Add server-side fallback using `ffprobe` wrapper in `scripts/cli/probe-media.ts`
- **Verification**:
  - Upload a PNG with alpha → metadata.hasAlpha = true
  - Upload a 10s MP4 → metadata.durationSec ≈ 10, metadata.width/height/fps populated
  - Upload a GIF → metadata.durationSec > 0

**Task 1.3: ID Generator + Path→ID Migration**
- **Scope**: Utility to generate stable asset IDs and migrate existing paths to IDs
- **Files Touched**:
  - Create `editor/src/utils/assetId.ts` — `generateAssetId()` using nanoid, `isAssetId(str)` guard
  - Create `scripts/cli/migrate-timeline-assets.ts` — scan timeline.json, create records, rewrite props
- **Algorithm Pseudocode**:
  ```
  function migrateTimelineAssets(stem: string):
    timeline = readTimelineJson(stem)
    if timeline._migrated: return
    
    pathToIdMap = {}
    records = []
    
    for element in timeline.elements:
      for field in ["imageSrc", "videoSrc", "gifSrc", "imageSrcs", "videoSrcs", "gifSrcs"]:
        value = element.props[field]
        if !value: continue
        
        if Array.isArray(value):
          element.props[field] = value.map(path => getOrCreateAssetId(path, pathToIdMap, records))
        else:
          element.props[field] = getOrCreateAssetId(value, pathToIdMap, records)
    
    timeline._migrated = true
    writeAssetsJson(stem, { version: 1, records })
    writeTimelineJson(stem, timeline)
  
  function getOrCreateAssetId(path, pathToIdMap, records):
    if pathToIdMap[path]: return pathToIdMap[path]
    
    id = generateAssetId()
    metadata = scanMetadata(path)
    record = { id, path, ...detectKindScopeEtc(path), metadata, addedAt: Date.now() }
    
    pathToIdMap[path] = id
    records.push(record)
    return id
  ```
- **Verification**:
  - Run migration on a test project with 3 timeline elements using 2 unique assets
  - Confirm `assets.json` has 2 records
  - Confirm timeline.json props now reference "ast_..." IDs
  - Confirm `_migrated: true` flag present
  - Re-run migration → no changes (idempotent)

---

### Phase 2: Editor Integration (3 tasks)

**Task 2.1: Asset Registry Store**
- **Scope**: Zustand store slice for in-memory AssetRecord[] + sync with backend
- **Files Touched**:
  - `editor/src/store.ts` — add `assetRecords: AssetRecord[]`, `loadAssetRecords()`, `addAssetRecord()`, `updateAssetRecord()`, `removeAssetRecord()`
  - `editor/src/hooks/useAssetRecordsSync.ts` — poll `/api/assets/registry/:stem`, autosave on mutation
- **Verification**:
  - Editor loads → `assetRecords` populated from `assets.json`
  - Add a new asset via upload → store updates, `assets.json` persists new record
  - Rename an asset path via editor UI → record.path updates, timeline elements unchanged

**Task 2.2: Resolver Integration in Renderer**
- **Scope**: Make `resolveStatic()` helper resolve asset IDs to paths
- **Files Touched**:
  - `src/compositions/elements/_helpers.ts` — update `resolveStatic(src, staticFile)` to check `isAssetId(src)` and resolve via global registry
  - `src/Root.tsx` — inject asset registry into composition props (or use a global singleton)
  - All element modules (StaticImage, GifClip, VideoClip, etc.) — no changes needed if they already use `resolveStatic()`
- **Algorithm**:
  ```typescript
  // Before (legacy)
  export const resolveStatic = (path: string, staticFile: (path: string) => string): string => {
    return path.startsWith("http") ? path : staticFile(path);
  };
  
  // After (asset-aware)
  export const resolveStatic = (
    src: string,
    staticFile: (path: string) => string,
    registry?: Map<string, AssetRecord>
  ): string => {
    if (src.startsWith("http")) return src;
    
    if (isAssetId(src)) {
      const record = registry?.get(src);
      if (!record) {
        console.warn(`Asset ID ${src} not found in registry`);
        return ""; // fallback to empty = no image shown
      }
      return staticFile(record.path);
    }
    
    // Legacy path string
    return staticFile(src);
  };
  ```
- **Verification**:
  - Render a composition with `imageSrc: "ast_x7k2m9p4n8q1"` → image appears
  - Render a composition with `imageSrc: "assets/images/logo.png"` (legacy) → image appears
  - Render with invalid asset ID `"ast_nonexistent"` → no crash, console warning, blank space

**Task 2.3: AssetLibrary UI Updates**
- **Scope**: Update AssetLibrary to use AssetRecord instead of raw AssetEntry
- **Files Touched**:
  - `editor/src/components/AssetLibrary.tsx` — fetch from `/api/assets/registry/:stem` instead of `/api/assets/list`
  - `editor/src/utils/assets.ts` — update `seededPropsForAsset()` to use asset ID instead of path
  - Add UI for editing labels/tags/notes per asset
- **Verification**:
  - Click an asset tile → element created with `imageSrc: "ast_..."` (not raw path)
  - Edit an asset's label → label updates in UI and persists to `assets.json`
  - Add tags to an asset → tags appear in UI, persist to `assets.json`

---

### Phase 3: Migration On Editor Boot (1 task)

**Task 3.1: Auto-Migration Hook**
- **Scope**: Run migration automatically on first editor load for un-migrated projects
- **Files Touched**:
  - `editor/src/App.tsx` — add `useEffect` to check `timeline._migrated` flag on mount
  - Call `POST /api/assets/migrate/:stem` if not migrated
  - Show migration progress UI (spinner + "Migrating assets to new format…")
- **Algorithm**:
  ```typescript
  useEffect(() => {
    if (!currentStem) return;
    
    const checkMigration = async () => {
      const timeline = await fetch(`/api/timeline/${currentStem}`).then(r => r.json());
      if (timeline._migrated) return;
      
      setMigrationStatus("Migrating assets to new format…");
      await fetch(`/api/assets/migrate/${currentStem}`, { method: "POST" });
      setMigrationStatus(null);
      
      // Reload timeline + asset records
      await loadTimeline(currentStem);
      await loadAssetRecords(currentStem);
    };
    
    void checkMigration();
  }, [currentStem]);
  ```
- **Verification**:
  - Load an old project (no `_migrated` flag) → migration runs, UI shows spinner
  - Reload editor → no migration (flag present), boots normally
  - Check `assets.json` → all referenced assets have records

---

### Phase 4: Asset Rename/Move Resilience (2 tasks)

**Task 4.1: File Watcher for Asset Moves**
- **Scope**: Detect when an asset file is moved/renamed on disk, update AssetRecord.path
- **Files Touched**:
  - `editor/sidecar.ts` — add `chokidar` watcher for `public/assets/**` and `projects/<stem>/{images,videos,gifs}/**`
  - On rename/move: find AssetRecord by old path, update to new path, persist `assets.json`
- **Verification**:
  - Rename `assets/images/logo.png` → `assets/images/brand-logo.png` on disk
  - Reload editor → timeline element with `ast_x7k2m9p4n8q1` still shows correct image
  - Check `assets.json` → record.path updated to `assets/images/brand-logo.png`

**Task 4.2: Orphan Detection + Cleanup**
- **Scope**: Warn when AssetRecords point to missing files; offer bulk cleanup
- **Files Touched**:
  - `editor/src/components/AssetLibrary.tsx` — add "Check for Missing Assets" button
  - Scans all records, checks file existence via `fs.existsSync()` on backend
  - Shows list of orphans with options: "Relink" (file picker), "Remove Record"
- **Verification**:
  - Delete `assets/images/logo.png` from disk (leave record in `assets.json`)
  - Click "Check for Missing Assets" → logo record flagged as orphan
  - Click "Remove Record" → record deleted, timeline element shows blank (graceful degradation)

---

### Phase 5: Advanced Features (deferred, 2 tasks)

**Task 5.1: Asset Packs**
- **Scope**: Export a subset of AssetRecords as a reusable pack, import into other projects
- **Files Touched**:
  - Create `scripts/cli/export-asset-pack.ts` — select assets by tag, zip files + manifest
  - Create `scripts/cli/import-asset-pack.ts` — unzip, merge records, copy files to target project
- **Verification**:
  - Export assets tagged "intro" from project A → `intro-pack.zip` created
  - Import pack into project B → assets appear in AssetLibrary with original tags
  - Timeline element referencing pack asset in project B → renders correctly

**Task 5.2: Cross-Project Asset Reuse**
- **Scope**: Allow referencing another project's assets without copying files
- **Files Touched**:
  - `editor/src/utils/assets.ts` — add `scope: "external"` for cross-project references
  - AssetRecord gains `externalStem?: string` field for `scope=external`
- **Verification**:
  - Project B references asset from project A → record.scope=external, record.externalStem="dubfire"
  - Render project B → resolver fetches asset from `projects/dubfire/images/...`
  - Delete project A → project B shows orphan warning (graceful degradation)

---

## 4. Backward Compatibility

### Supporting Both Formats

**Renderer Dual-Mode**: The `resolveStatic()` helper checks value format. If it starts with `"ast_"`, resolve via registry. Otherwise, treat as legacy path string. This means:
- New projects (post-migration) use asset IDs exclusively
- Old projects (pre-migration) continue to work with path strings
- Mixed timelines (user manually edits JSON to add legacy path) work fine

**Editor Behavior**: The AssetLibrary always creates new elements with asset IDs. If a user edits `timeline.json` by hand and adds a raw path string, the editor shows it as-is (no auto-migration on edit, only on first boot).

### Migration Path for Existing Projects

1. **On First Editor Load**: Check `timeline._migrated` flag. If absent, run migration (Phase 3, Task 3.1).
2. **Migration Steps**:
   - Scan all timeline elements for media field values
   - Create AssetRecord for each unique path
   - Replace path strings with generated asset IDs
   - Write `assets.json` + updated `timeline.json`
   - Set `_migrated: true` flag
3. **User Experience**: Show a one-time spinner with message "Upgrading assets to new format…". Takes <1s for typical projects (10-50 assets).

### Rollback Safety

**Downgrade Scenario**: User updates to new editor, migrates, then reverts to old editor version.

**What Breaks**: Timeline elements have `imageSrc: "ast_x7k2m9p4n8q1"` instead of paths. Old editor passes this to `staticFile()` → Remotion looks for file at `public/ast_x7k2m9p4n8q1` → not found → blank image.

**Recovery**: Run reverse migration script:
```bash
npm run mv:reverse-asset-migration -- --project <stem>
```
This script:
1. Reads `assets.json`
2. Scans timeline elements for asset IDs
3. Replaces IDs with `record.path`
4. Removes `_migrated` flag
5. Writes updated `timeline.json`

**Safety Net**: The reverse migration script is idempotent. If `assets.json` is missing, it logs a warning and exits cleanly (no data loss).

---

## 5. Rollout Plan

### Phase Sequencing

**Phase 1 (Core Infrastructure)** must complete first. Phases 2-3 can overlap partially (Task 2.1 can start while Task 1.3 finishes). Phase 4 depends on Phase 3. Phase 5 is deferred until real-world feedback confirms the core migration is stable.

**Priority Order**:
1. **Phase 1**: Build the foundation (AssetRecord type, storage, metadata scanner, migration script)
2. **Phase 3**: Auto-migration on editor boot (unblocks existing projects)
3. **Phase 2**: Editor integration (makes new assets use IDs by default)
4. **Phase 4**: Rename resilience (quality-of-life improvement)
5. **Phase 5**: Advanced features (deferred, optional)

### What Gets Implemented First

**Minimum Viable Migration (MVP)**:
- Phase 1 (all tasks)
- Phase 3 (Task 3.1)
- Phase 2 (Task 2.1, Task 2.2 only)

This MVP ensures:
- Existing projects migrate automatically
- Renders work with both IDs and legacy paths
- No data loss on migration

**What Can Be Deferred**:
- Phase 2, Task 2.3 (AssetLibrary UI) — can ship later as a UX improvement
- Phase 4 (rename resilience) — nice-to-have, not blocking
- Phase 5 (asset packs) — future enhancement

### Deployment Timeline

**Week 1**: Phase 1 (core infrastructure)  
**Week 2**: Phase 3 (auto-migration) + Phase 2 partial (resolver)  
**Week 3**: Phase 2 complete (AssetLibrary UI updates)  
**Week 4**: Phase 4 (rename resilience)  
**Week 5+**: Phase 5 (deferred, on-demand)

---

## 6. Verification Strategy

### Per-Phase Verification

Each phase includes task-level verification criteria (see Phase sections above). Key regression tests:

**Phase 1 Verification**:
- Upload 5 different assets (PNG, JPG, MP4, GIF, WEBP) → all metadata fields populated correctly
- Run migration on test project with 10 elements → `assets.json` has correct record count
- Re-run migration → no duplicate records (idempotency)

**Phase 2 Verification**:
- Create new element via AssetLibrary → props contain asset ID, not path
- Render composition with asset ID → image/video appears
- Render composition with legacy path → image/video appears (backward compat)
- Render composition with invalid asset ID → console warning, no crash

**Phase 3 Verification**:
- Load un-migrated project → migration runs, spinner appears, completes <2s
- Reload editor → no migration, boots instantly
- Check `assets.json` → all referenced paths have records

**Phase 4 Verification**:
- Rename asset file on disk → record.path updates automatically
- Move asset to different folder → path updates, timeline still renders
- Delete asset file → orphan detection flags it, timeline shows blank (graceful)

### Regression Test Suite

**Create** `scripts/test-asset-migration.ts`:
1. Scaffold test project with 5 assets (2 images, 1 video, 1 GIF, 1 multi-value field)
2. Run migration
3. Assert `assets.json` has 5 records
4. Assert all timeline elements have asset IDs
5. Render composition → assert PNG output >2KB (something drew)
6. Rename asset on disk → assert record.path updated
7. Reverse migration → assert timeline has paths again
8. Re-migrate → assert idempotent (same record IDs)

**Run After Every Commit**: Add to `.github/workflows/test.yml` (if CI exists) or pre-commit hook.

---

## 7. Rollback Plan

### What If Migration Breaks Existing Projects?

**Symptoms**:
- Editor loads but timeline shows blank elements
- Render produces empty video
- `assets.json` missing or corrupted

**Recovery Steps**:

**Step 1: Verify Backup**
- Before migration, the editor creates `timeline.json.pre-migration` and `assets.json.pre-migration` in `projects/<stem>/`
- Check if these exist: `ls projects/<stem>/*.pre-migration`

**Step 2: Restore Backup**
```bash
cd projects/<stem>
cp timeline.json.pre-migration timeline.json
rm assets.json  # if it exists
```

**Step 3: Reload Editor**
- Editor detects missing `_migrated` flag → migration runs again
- If migration fails again, it's a bug in the migration script (not data corruption)

**Step 4: Manual Rollback (Last Resort)**
```bash
npm run mv:reverse-asset-migration -- --project <stem>
```
This script:
1. Reads `assets.json` (if it exists)
2. Scans timeline elements for asset IDs
3. Replaces IDs with paths from records
4. Removes `_migrated` flag
5. Writes `timeline.json`

If `assets.json` is missing, the script cannot reverse the migration. In this case, the user must restore from their own backup (git history, Time Machine, etc.).

### Preventing Data Loss

**Pre-Migration Backup**: Before running migration, copy `timeline.json` → `timeline.json.pre-migration`. This is automatic in the migration script (Phase 1, Task 1.3).

**Git Commit Before Migration**: Recommended workflow in docs:
```bash
git add projects/<stem>/timeline.json
git commit -m "checkpoint before asset migration"
npm run dev  # migration runs automatically
```

**Validation After Migration**:
- Compare element count before/after → should be identical
- Render a still frame before/after → visual diff should show no changes

**Abort Conditions**: The migration script exits early (no writes) if:
- `timeline.json` is malformed JSON
- `timeline.json` contains non-string values in media fields (type safety violation)
- Any asset path references a file that doesn't exist (orphan detection pre-flight)

---

## 8. Success Criteria

**Phase 1 Complete When**:
- AssetRecord type defined + validated with Zod schema
- `assets.json` read/write working via sidecar API
- Metadata scanner extracts width/height/duration for 5 asset kinds
- Migration script converts timeline paths → IDs idempotently

**Phase 2 Complete When**:
- Editor loads asset records into Zustand store
- AssetLibrary creates elements with asset IDs (not paths)
- Renderer resolves asset IDs to paths correctly
- Legacy path strings still work (backward compat verified)

**Phase 3 Complete When**:
- Un-migrated projects auto-migrate on first editor load
- Migration progress UI appears during migration
- `_migrated` flag prevents re-migration
- Pre-migration backup created automatically

**Phase 4 Complete When**:
- Asset file rename on disk updates record.path without touching timeline
- Orphan detection flags missing files
- User can relink or remove orphans via UI

**Overall Success**:
- User renames `logo.png` → `brand-logo.png` on disk → timeline still shows logo
- User copies timeline element from project A → project B → asset renders (because ID is stable)
- User deletes an asset file → timeline shows blank, no crash, orphan cleanup available
- User downgrades to old editor → reverse migration script restores paths

---

## 9. Open Questions

1. **Should global-scope assets have a shared registry?** Current plan: each project has its own `assets.json` with global assets duplicated. Alternative: single `public/assets/registry.json` shared across projects. Trade-off: shared registry enables cross-project tags but complicates per-project asset management.

2. **How to handle asset ID collisions across projects?** If user copies `timeline.json` from project A → project B, asset IDs reference records that don't exist in project B's `assets.json`. Options: (a) auto-create orphan records, (b) show "missing asset" warning, (c) auto-import referenced assets from project A.

3. **Should metadata be re-scanned periodically?** If user replaces `logo.png` with a different file (same name, different dimensions), the AssetRecord metadata is stale. Options: (a) re-scan on mtime change, (b) manual "Refresh Metadata" button, (c) never re-scan (user must delete + re-import).

4. **Asset versioning?** If user replaces `logo.png`, should the old version be preserved? Options: (a) no versioning (destructive replace), (b) store old version as `logo.v1.png`, (c) full version history in `assets.json` with `record.versions[]` array.

---

## 10. Related Work

- **AssetLibrary UI** (already implemented): Provides visual asset browser with drag-drop, filtering, and upload. This migration enhances it with stable IDs + metadata caching.
- **MediaFieldDefinition** (already implemented): Element modules declare `mediaFields` so AssetLibrary knows which assets are compatible. No changes needed to this system.
- **Timeline Undo/Redo** (already implemented): Asset ID changes are prop updates, so undo/redo works automatically.
- **Project Scaffolding** (`mv:scaffold`): New projects start with empty `assets.json`. Migration only runs for legacy projects.

---

## Appendix: Code Examples

### AssetRecord ID Generation

```typescript
// editor/src/utils/assetId.ts
import { nanoid } from "nanoid";

export const generateAssetId = (): string => `ast_${nanoid(12)}`;

export const isAssetId = (value: string): boolean => /^ast_[A-Za-z0-9_-]{12}$/.test(value);
```

### Migration Script Core Logic

```typescript
// scripts/cli/migrate-timeline-assets.ts
import { readTimelineJson, writeTimelineJson } from "./projectJson.js";
import { readAssetsJson, writeAssetsJson } from "./asset-registry.js";
import { generateAssetId } from "../../editor/src/utils/assetId.js";
import { scanMetadata } from "../../editor/src/utils/assetMetadata.js";

export async function migrateTimelineAssets(stem: string): Promise<void> {
  const timeline = readTimelineJson(stem);
  if (timeline._migrated) {
    console.log(`Timeline already migrated for ${stem}`);
    return;
  }

  // Backup
  writeTimelineJson(stem, timeline, { suffix: ".pre-migration" });

  const pathToIdMap = new Map<string, string>();
  const records: AssetRecord[] = [];

  for (const element of timeline.elements) {
    for (const field of MEDIA_FIELDS) {
      const value = element.props[field];
      if (!value) continue;

      if (Array.isArray(value)) {
        element.props[field] = value.map((path) =>
          getOrCreateAssetId(path, pathToIdMap, records)
        );
      } else if (typeof value === "string") {
        element.props[field] = getOrCreateAssetId(value, pathToIdMap, records);
      }
    }
  }

  timeline._migrated = true;
  writeAssetsJson(stem, { version: 1, records });
  writeTimelineJson(stem, timeline);
  
  console.log(`Migrated ${records.length} assets for ${stem}`);
}

function getOrCreateAssetId(
  path: string,
  pathToIdMap: Map<string, string>,
  records: AssetRecord[]
): string {
  if (pathToIdMap.has(path)) return pathToIdMap.get(path)!;

  const id = generateAssetId();
  const metadata = scanMetadata(path); // sync or async depending on implementation
  const record = {
    id,
    path,
    ...detectKindScopeEtc(path),
    metadata,
    addedAt: Date.now(),
  };

  pathToIdMap.set(path, id);
  records.push(record);
  return id;
}
```

### Resolver Integration

```typescript
// src/compositions/elements/_helpers.ts
import type { AssetRecord } from "../../editor/src/types/assets";
import { isAssetId } from "../../editor/src/utils/assetId";

let globalAssetRegistry: Map<string, AssetRecord> | null = null;

export function setAssetRegistry(records: AssetRecord[]): void {
  globalAssetRegistry = new Map(records.map((r) => [r.id, r]));
}

export const resolveStatic = (
  src: string,
  staticFile: (path: string) => string
): string => {
  if (src.startsWith("http")) return src;

  if (isAssetId(src)) {
    const record = globalAssetRegistry?.get(src);
    if (!record) {
      console.warn(`Asset ID ${src} not found in registry`);
      return "";
    }
    return staticFile(record.path);
  }

  // Legacy path string
  return staticFile(src);
};
```

---

**End of Plan**
