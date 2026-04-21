import type { AssetEntry as EditorAssetEntry, AssetKind } from "../types/assets";
import type { ElementModule, MediaFieldDefinition } from "@compositions/elements/types";

export type { AssetKind, EditorAssetEntry };

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

export const seededPropsForModuleAsset = <T extends Record<string, unknown>>(
  mod: Pick<ElementModule<T>, "defaults" | "mediaFields">,
  kind: AssetKind,
  path: string,
): T & Record<string, unknown> => {
  const preferredField = findMediaFieldForKind(mod.mediaFields, kind, false);
  if (preferredField) {
    return {
      ...mod.defaults,
      [preferredField.name]: path,
    };
  }
  return seededPropsForAsset(kind, path, mod.defaults);
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
