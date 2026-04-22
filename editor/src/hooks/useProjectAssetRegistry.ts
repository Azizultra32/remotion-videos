import { useEffect, useMemo } from "react";
import {
  ASSET_REGISTRY_UPDATED_EVENT,
  type EnrichAssetRecordsInput,
  enrichAssetRecords,
  loadAssetRegistry,
  needsAssetEnrichment,
  reconcileAssetRegistry,
} from "../lib/assetRecordStore";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

let mountedConsumers = 0;
let activeStem: string | null = null;
let loadedStem: string | null = null;
let syncGeneration = 0;
let inFlightStem: string | null = null;
let inFlightSync: Promise<void> | null = null;
let hasRegistryListener = false;
const enrichmentSignatureByStem = new Map<string, string>();

const writeRegistryState = (
  records: ReturnType<typeof useEditorStore.getState>["assetRecords"],
  error: string | null,
) => {
  useEditorStore.setState({
    assetRecords: records,
    assetRegistryError: error,
  });
};

const clearProjectAssetRegistry = () => {
  const previousStem = activeStem;
  syncGeneration += 1;
  activeStem = null;
  loadedStem = null;
  inFlightStem = null;
  inFlightSync = null;
  if (previousStem) {
    enrichmentSignatureByStem.delete(previousStem);
  }
  writeRegistryState([], null);
};

const syncProjectAssetRegistry = (stem: string, force = false): Promise<void> => {
  if (!force && inFlightSync && inFlightStem === stem) {
    return inFlightSync;
  }

  const generation = ++syncGeneration;
  activeStem = stem;
  inFlightStem = stem;

  const sync = loadAssetRegistry(stem)
    .then((records) => {
      if (activeStem !== stem || syncGeneration !== generation) return;
      loadedStem = stem;
      writeRegistryState(records, null);
    })
    .catch((err) => {
      if (activeStem !== stem || syncGeneration !== generation) return;
      loadedStem = stem;
      writeRegistryState([], String(err));
    })
    .finally(() => {
      if (inFlightSync === sync) {
        inFlightStem = null;
        inFlightSync = null;
      }
    });

  inFlightSync = sync;
  return sync;
};

const onRegistryUpdated = (event: Event) => {
  const stem = activeStem;
  if (!stem) return;

  const detail = (event as CustomEvent<{ stem?: string }>).detail;
  if (detail?.stem && detail.stem !== stem) return;

  void syncProjectAssetRegistry(stem, true);
};

const retainRegistryListener = () => {
  mountedConsumers += 1;
  if (!hasRegistryListener) {
    window.addEventListener(ASSET_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
    hasRegistryListener = true;
  }
};

const releaseRegistryListener = () => {
  mountedConsumers = Math.max(0, mountedConsumers - 1);
  if (mountedConsumers === 0 && hasRegistryListener) {
    window.removeEventListener(ASSET_REGISTRY_UPDATED_EVENT, onRegistryUpdated);
    hasRegistryListener = false;
    clearProjectAssetRegistry();
  }
};

export const useProjectAssetRegistry = () => {
  const audioSrc = useEditorStore((state) => state.audioSrc);
  const assetRecords = useEditorStore((state) => state.assetRecords);
  const assetRegistryError = useEditorStore((state) => state.assetRegistryError);
  const currentStem = stemFromAudioSrc(audioSrc);
  const missingAssetRecords = useMemo(
    () => assetRecords.filter((record) => record.status === "missing"),
    [assetRecords],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    retainRegistryListener();
    return () => {
      releaseRegistryListener();
    };
  }, []);

  useEffect(() => {
    if (!currentStem) {
      clearProjectAssetRegistry();
      return;
    }

    activeStem = currentStem;
    if (loadedStem === currentStem || (inFlightSync && inFlightStem === currentStem)) {
      return;
    }
    void syncProjectAssetRegistry(currentStem);
  }, [currentStem]);

  useEffect(() => {
    if (!currentStem || assetRegistryError || assetRecords.length === 0) return;

    const pendingIds = assetRecords
      .filter((record) => needsAssetEnrichment(record))
      .map((record) => record.id)
      .sort();
    const signature = pendingIds.join(",");

    if (!signature) {
      enrichmentSignatureByStem.delete(currentStem);
      return;
    }

    if (enrichmentSignatureByStem.get(currentStem) === signature) {
      return;
    }

    enrichmentSignatureByStem.set(currentStem, signature);
    void enrichAssetRecords(currentStem, { ids: pendingIds }).catch(() => {
      if (enrichmentSignatureByStem.get(currentStem) === signature) {
        enrichmentSignatureByStem.delete(currentStem);
      }
    });
  }, [assetRecords, assetRegistryError, currentStem]);

  return {
    assetRecords,
    missingAssetRecords,
    assetRegistryError,
    currentStem,
    enrichAssetRegistry: (input?: EnrichAssetRecordsInput) => {
      if (!currentStem) return Promise.resolve([]);
      const ids =
        input?.ids ??
        assetRecords.filter((record) => needsAssetEnrichment(record)).map((record) => record.id);
      return enrichAssetRecords(currentStem, { ids });
    },
    runAssetReconcile: async () => {
      const stem = currentStem;
      if (!stem) return [];
      const records = await reconcileAssetRegistry(stem);
      if (stemFromAudioSrc(useEditorStore.getState().audioSrc) !== stem) {
        return records;
      }
      if (records.length > 0) {
        loadedStem = stem;
        writeRegistryState(records, null);
        return records;
      }
      await syncProjectAssetRegistry(stem, true);
      if (stemFromAudioSrc(useEditorStore.getState().audioSrc) !== stem) {
        return records;
      }
      return useEditorStore.getState().assetRecords;
    },
  };
};
