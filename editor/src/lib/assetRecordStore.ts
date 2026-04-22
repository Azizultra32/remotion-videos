import { useEditorStore } from "../store";
import type {
  AssetId,
  AssetKind,
  AssetRecord,
  AssetRecordV2,
  AssetRegistryFile,
} from "../types/assetRecord";
import {
  AssetRecordV2Schema,
  AssetRegistryFileSchema,
  isValidAssetId,
  normalizeAssetRecordV2,
} from "../types/assetRecord";
import { stemFromAudioSrc } from "../utils/url";

export const ASSET_REGISTRY_UPDATED_EVENT = "asset-registry-updated";

const recordMatchesId = (record: AssetRecord, id: string): boolean =>
  record.id === id || record.aliases?.includes(id as AssetId) === true;

export type EnsureAssetRecordInput = {
  path: string;
  kind?: AssetKind;
  label?: string;
};

export type EnrichAssetRecordInput = {
  id: AssetId;
};

export type EnrichAssetRecordsInput = {
  ids: AssetId[];
};

type EnrichAssetRecordsResponse = {
  records?: unknown[];
  record?: unknown;
  changed?: boolean;
  count?: number;
};

type ReconcileAssetRegistryResponse = {
  records?: unknown[];
  registry?: unknown;
  changed?: boolean;
  count?: number;
};

const inFlightAssetEnrichment = new Map<string, Promise<AssetRecordV2[]>>();

const notifyAssetRegistryUpdated = (stem: string, count?: number): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ASSET_REGISTRY_UPDATED_EVENT, {
      detail: { stem, ...(count !== undefined ? { count } : {}) },
    }),
  );
};

const shouldWriteToCurrentStem = (stem: string): boolean => {
  const currentStem = stemFromAudioSrc(useEditorStore.getState().audioSrc);
  return currentStem === stem;
};

export const needsAssetEnrichment = (record: AssetRecord): boolean => {
  if (record.status !== "active") return false;
  return (
    !record.contentHash ||
    record.hashVersion !== "sha256" ||
    Object.keys(record.metadata ?? {}).length === 0
  );
};

const normalizeAssetRecordList = (
  stem: string,
  payload: unknown,
  contextLabel: string,
): AssetRecordV2[] => {
  const records: unknown[] = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { records?: unknown[] }).records)
      ? (payload as { records: unknown[] }).records
      : [];

  const normalized: AssetRecordV2[] = [];
  for (const recordRaw of records) {
    const parsed = AssetRecordV2Schema.safeParse(recordRaw);
    if (!parsed.success) {
      console.warn(`Invalid ${contextLabel} payload for ${stem}:`, parsed.error.flatten());
      throw new Error(`Invalid ${contextLabel} payload for ${stem}`);
    }
    normalized.push(normalizeAssetRecordV2(parsed.data));
  }

  return normalized;
};

/**
 * Load asset registry from projects/<stem>/assets.json.
 * Returns normalized v2 records when possible. Missing files return an empty registry.
 */
export async function loadAssetRegistry(stem: string): Promise<AssetRecord[]> {
  const response = await fetch(`/api/assets/registry/${stem}`);
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Failed to load asset registry: ${response.statusText}`);
  }

  const raw = await response.json();
  const parsed = AssetRegistryFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`Invalid asset registry for ${stem}:`, parsed.error.flatten());
    throw new Error(`Invalid asset registry payload for ${stem}`);
  }

  return parsed.data.records.map((record) => normalizeAssetRecordV2(record));
}

/**
 * Save normalized v2 asset registry to projects/<stem>/assets.json.
 */
export async function saveAssetRegistry(stem: string, records: AssetRecord[]): Promise<void> {
  const normalized = records.map((record) => normalizeAssetRecordV2(record));
  const registry: AssetRegistryFile = {
    version: 2,
    records: normalized,
  };

  const parsed = AssetRegistryFileSchema.safeParse(registry);
  if (!parsed.success) {
    throw new Error(`Invalid asset registry payload: ${parsed.error.message}`);
  }

  const response = await fetch(`/api/assets/registry/${stem}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });

  if (!response.ok) {
    throw new Error(`Failed to save asset registry: ${response.statusText}`);
  }

  notifyAssetRegistryUpdated(stem, records.length);
}

/**
 * Ensure exactly one canonical asset record exists for the given asset path in
 * projects/<stem>/assets.json. The server performs the read/modify/write under
 * the registry lock to avoid stale client overwrites.
 */
export async function ensureAssetRecord(
  stem: string,
  input: EnsureAssetRecordInput,
): Promise<AssetRecordV2> {
  const response = await fetch(`/api/assets/ensure/${stem}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to ensure asset record: ${response.statusText}`);
  }

  const raw = await response.json();
  const parsed = AssetRecordV2Schema.safeParse(raw?.record ?? raw);
  if (!parsed.success) {
    console.warn(`Invalid ensure-asset-record payload for ${stem}:`, parsed.error.flatten());
    throw new Error(`Invalid ensure-asset-record payload for ${stem}`);
  }

  const record = normalizeAssetRecordV2(parsed.data);
  if (shouldWriteToCurrentStem(stem)) {
    useEditorStore.getState().upsertAssetRecord(record);
  }
  return record;
}

/**
 * Explicitly enrich one existing asset record after canonical identity exists.
 * This keeps ensure focused on identity creation while allowing metadata
 * probing to happen later and independently.
 */
export async function enrichAssetRecord(
  stem: string,
  input: EnrichAssetRecordInput,
): Promise<AssetRecordV2> {
  const response = await fetch(`/api/assets/enrich/${stem}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Failed to enrich asset record: ${response.statusText}`);
  }

  const raw = (await response.json()) as EnrichAssetRecordsResponse;
  const parsed = AssetRecordV2Schema.safeParse(raw?.record ?? raw?.records?.[0] ?? raw);
  if (!parsed.success) {
    console.warn(`Invalid enrich-asset-record payload for ${stem}:`, parsed.error.flatten());
    throw new Error(`Invalid enrich-asset-record payload for ${stem}`);
  }

  const record = normalizeAssetRecordV2(parsed.data);
  if (shouldWriteToCurrentStem(stem)) {
    useEditorStore.getState().upsertAssetRecord(record);
  }
  return record;
}

export async function enrichAssetRecords(
  stem: string,
  input: EnrichAssetRecordsInput,
): Promise<AssetRecordV2[]> {
  const requestBody: EnrichAssetRecordsInput = {
    ids: Array.from(new Set(input.ids.filter((value): value is AssetId => isValidAssetId(value)))),
  };
  if (requestBody.ids.length === 0) {
    return [];
  }

  const requestKey = JSON.stringify({
    stem,
    ids: requestBody.ids,
  });
  const existing = inFlightAssetEnrichment.get(requestKey);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    const response = await fetch(`/api/assets/enrich/${stem}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Failed to enrich asset records: ${response.statusText}`);
    }

    const raw = (await response.json()) as EnrichAssetRecordsResponse;
    const records = normalizeAssetRecordList(
      stem,
      Array.isArray(raw?.records) ? raw.records : raw?.record ? [raw.record] : [],
      "enrich-asset-record",
    );

    if (shouldWriteToCurrentStem(stem)) {
      const { upsertAssetRecord } = useEditorStore.getState();
      for (const record of records) {
        upsertAssetRecord(record);
      }
    }

    return records;
  })();

  inFlightAssetEnrichment.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (inFlightAssetEnrichment.get(requestKey) === request) {
      inFlightAssetEnrichment.delete(requestKey);
    }
  }
}

/**
 * Ask the server to reconcile projects/<stem>/assets.json against the files on disk.
 * Returns normalized records when the server includes them in the response.
 */
export async function reconcileAssetRegistry(stem: string): Promise<AssetRecordV2[]> {
  const response = await fetch(`/api/assets/reconcile/${stem}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to reconcile asset registry: ${response.statusText}`);
  }

  const raw = (await response.json()) as ReconcileAssetRegistryResponse;
  const registryPayload =
    raw?.registry && typeof raw.registry === "object"
      ? raw.registry
      : Array.isArray(raw?.records)
        ? { version: 2, records: raw.records }
        : raw;
  const hasInlineRegistry =
    Boolean(raw?.registry && typeof raw.registry === "object") || Array.isArray(raw?.records);

  const records = normalizeAssetRecordList(stem, registryPayload, "reconcile-asset-registry");
  if (hasInlineRegistry && shouldWriteToCurrentStem(stem)) {
    useEditorStore.setState({
      assetRecords: records,
      assetRegistryError: null,
    });
  }

  return records;
}

/**
 * Find an asset record by its path.
 * Returns null if not found.
 */
export function findAssetByPath(records: AssetRecord[], path: string): AssetRecord | null {
  return records.find((r) => r.path === path) || null;
}

/**
 * Find an asset record by its ID or alias.
 * Returns null if not found.
 */
export function findAssetById(records: AssetRecord[], id: AssetId): AssetRecord | null {
  if (!isValidAssetId(id)) return null;
  return records.find((record) => recordMatchesId(record, id)) || null;
}

/**
 * Resolve a path or asset ID to the actual file path.
 * Supports canonical IDs, legacy aliases, and raw path fallback.
 */
export function resolveAssetPath(records: AssetRecord[], pathOrId: string): string | null {
  if (isValidAssetId(pathOrId)) {
    const record = findAssetById(records, pathOrId as AssetId);
    return record?.path || null;
  }
  return pathOrId;
}
