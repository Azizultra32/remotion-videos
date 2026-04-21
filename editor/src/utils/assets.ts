import type { ElementModule, MediaFieldDefinition } from "@compositions/elements/types";
import type { AssetEntry as EditorAssetEntry, AssetKind, AssetScope } from "../types/assets";

export type { AssetKind, AssetScope, EditorAssetEntry };

export type AssetScopeFilter = "all" | AssetScope;
export type AssetSortMode = "recent" | "name" | "size";

export const IMAGE_MODULE_ID = "overlay.staticImage";
export const GIF_MODULE_ID = "overlay.gif";
export const VIDEO_MODULE_ID = "overlay.speedVideo";

export const moduleIdForAssetKind = (kind: AssetKind): string => {
  switch (kind) {
    case "image":
      return IMAGE_MODULE_ID;
    case "gif":
      return GIF_MODULE_ID;
    case "video":
      return VIDEO_MODULE_ID;
  }
};

export const findMediaFieldForKind = (
  mediaFields: readonly MediaFieldDefinition[] | undefined,
  kind: AssetKind,
  multi = false,
): MediaFieldDefinition | null => {
  if (!mediaFields?.length) return null;
  return mediaFields.find((field) => field.kind === kind && Boolean(field.multi) === multi) ?? null;
};

export const findMediaFieldsForKind = (
  mediaFields: readonly MediaFieldDefinition[] | undefined,
  kind: AssetKind,
): MediaFieldDefinition[] => {
  if (!mediaFields?.length) return [];
  return mediaFields.filter((field) => field.kind === kind);
};

export const humanizeFieldName = (name: string): string =>
  name
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

export const mediaFieldLabel = (field: Pick<MediaFieldDefinition, "name" | "label">): string =>
  field.label?.trim() || humanizeFieldName(field.name);

export const describeMediaFieldAction = (field: Pick<MediaFieldDefinition, "name" | "label" | "multi">): string =>
  field.multi ? `Append to ${mediaFieldLabel(field)}` : `Replace ${mediaFieldLabel(field)}`;

const applyAssetToMediaField = <T extends Record<string, unknown>>(
  currentProps: T,
  field: Pick<MediaFieldDefinition, "name" | "multi">,
  path: string,
): T & Record<string, unknown> => {
  if (field.multi) {
    const currentValue = currentProps[field.name];
    const currentList = Array.isArray(currentValue)
      ? currentValue.filter((item): item is string => typeof item === "string")
      : [];
    return {
      ...currentProps,
      [field.name]: currentList.includes(path) ? currentList : [...currentList, path],
    };
  }

  return {
    ...currentProps,
    [field.name]: path,
  };
};

const resolvePreferredField = (
  mediaFields: readonly MediaFieldDefinition[] | undefined,
  kind: AssetKind,
  preferredFieldName?: string,
): MediaFieldDefinition | null => {
  const matchingFields = findMediaFieldsForKind(mediaFields, kind);
  if (matchingFields.length === 0) return null;
  if (preferredFieldName) {
    const explicitField = matchingFields.find((field) => field.name === preferredFieldName);
    if (explicitField) return explicitField;
  }
  return matchingFields.find((field) => !field.multi) ?? matchingFields[0] ?? null;
};

export const seededPropsForModuleAsset = <T extends Record<string, unknown>>(
  mod: Pick<ElementModule<T>, "defaults" | "mediaFields">,
  kind: AssetKind,
  path: string,
): T & Record<string, unknown> => {
  const preferredField = resolvePreferredField(mod.mediaFields, kind);
  if (preferredField) {
    return applyAssetToMediaField(mod.defaults, preferredField, path);
  }
  return seededPropsForAsset(kind, path, mod.defaults);
};

export const applyAssetToModuleProps = <T extends Record<string, unknown>>(
  mod: Pick<ElementModule<T>, "mediaFields">,
  currentProps: T,
  kind: AssetKind,
  path: string,
  preferredFieldName?: string,
): T & Record<string, unknown> => {
  const preferredField = resolvePreferredField(mod.mediaFields, kind, preferredFieldName);
  if (preferredField) {
    return applyAssetToMediaField(currentProps, preferredField, path);
  }

  return seededPropsForAsset(kind, path, currentProps);
};

export const seededPropsForAsset = <T extends Record<string, unknown>>(
  kind: AssetKind,
  path: string,
  defaults: T,
): T & Record<string, unknown> => {
  switch (kind) {
    case "image":
      return { ...defaults, imageSrc: path };
    case "gif":
      return { ...defaults, gifSrc: path };
    case "video":
      return { ...defaults, videoSrc: path };
  }
};

export const detectAssetKindFromFieldName = (name: string): AssetKind | null => {
  const n = name.toLowerCase();
  if (/(^|_)(gif)s?$|gif(src|path|url)$|backgroundgif$/.test(n)) return "gif";
  if (/(^|_)(image|img)s?$|image(src|path|url)$|backgroundimage$/.test(n)) return "image";
  if (/(^|_)(video|clip)s?$|video(src|path|url)$|backgroundvideo$/.test(n)) return "video";
  return null;
};

export const assetKindLabel = (kind: AssetKind): string => {
  switch (kind) {
    case "image":
      return "image";
    case "gif":
      return "GIF";
    case "video":
      return "video";
  }
};

const GIF_FILE_EXT = /\.gif$/i;
const IMAGE_FILE_EXT = /\.(png|jpe?g|webp|avif|bmp|svg)$/i;
const VIDEO_FILE_EXT = /\.(mp4|webm|mov|mkv|avi)$/i;

export const assetPickerAccept = (kind: AssetKind): string => {
  switch (kind) {
    case "image":
      return "image/png,image/jpeg,image/webp,image/avif,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.webp,.avif,.bmp,.svg";
    case "gif":
      return "image/gif,.gif";
    case "video":
      return "video/*,.mp4,.webm,.mov,.mkv,.avi";
  }
};

export const detectAssetKindFromUpload = (file: Pick<File, "name" | "type">): AssetKind | null => {
  const mime = file.type.trim().toLowerCase();
  if (mime === "image/gif" || GIF_FILE_EXT.test(file.name)) return "gif";
  if (mime.startsWith("image/") || IMAGE_FILE_EXT.test(file.name)) return "image";
  if (mime.startsWith("video/") || VIDEO_FILE_EXT.test(file.name)) return "video";
  return null;
};

export const assetScopeLabel = (scope: AssetScope, stem: string | null): string =>
  scope === "global" ? "Library" : `Project ${stem ?? ""}`.trim();

export const assetMediaHint = (kind: AssetKind): string => {
  if (kind === "video") {
    return "Drop files into public/assets/videos/ or projects/<stem>/videos/.";
  }
  if (kind === "gif") {
    return "Drop files into public/assets/gifs/ or projects/<stem>/gifs/.";
  }
  return "Drop files into public/assets/images/ or projects/<stem>/images/.";
};

export const assetUrlFor = (entry: Pick<EditorAssetEntry, "path">): string =>
  entry.path.startsWith("assets/")
    ? `/${entry.path}`
    : `/api/projects/${entry.path.replace(/^projects\//, "")}`;

export const assetPreviewUrlFor = (
  entry: Pick<EditorAssetEntry, "kind" | "path">,
): string => (entry.kind === "gif"
  ? `/api/assets/thumb?path=${encodeURIComponent(entry.path)}`
  : assetUrlFor(entry));

export const formatAssetBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatAssetDuration = (sec: number): string => {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const mins = Math.floor(sec / 60);
  const rem = Math.round(sec % 60).toString().padStart(2, "0");
  return `${mins}:${rem}`;
};

export const formatAssetTimestamp = (mtime: number): string =>
  Number.isFinite(mtime) ? new Date(mtime).toLocaleString() : "Unknown time";

const assetSearchText = (entry: EditorAssetEntry): string =>
  [
    entry.path,
    entry.filename,
    entry.label,
    entry.kind,
    entry.scope,
    entry.stem ?? "",
  ]
    .join(" ")
    .toLowerCase();

export const filterAndSortAssets = (
  entries: readonly EditorAssetEntry[],
  {
    kind = "all",
    scope = "all",
    search = "",
    sort = "recent",
  }: {
    kind?: "all" | AssetKind;
    scope?: AssetScopeFilter;
    search?: string;
    sort?: AssetSortMode;
  },
): EditorAssetEntry[] => {
  const query = search.trim().toLowerCase();
  const next = entries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (scope !== "all" && entry.scope !== scope) return false;
    if (query && !assetSearchText(entry).includes(query)) return false;
    return true;
  });

  next.sort((a, b) => {
    if (sort === "name") {
      const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
      if (byLabel !== 0) return byLabel;
      return b.mtime - a.mtime;
    }
    if (sort === "size") {
      if (b.size !== a.size) return b.size - a.size;
      return b.mtime - a.mtime;
    }
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  return next;
};
