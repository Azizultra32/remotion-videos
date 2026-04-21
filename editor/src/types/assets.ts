export type AssetKind = "image" | "video" | "gif";

export type AssetScope = "global" | "project";

export type AssetFolderDescriptor = {
  id: string;
  path: string;
  name: string;
  segments: string[];
};

export type AssetUrlSet = {
  original: string;
  preview: string;
  thumbnail: string | null;
};

export type AssetCapabilities = {
  canDelete: boolean;
  canPreview: boolean;
  canReferenceByPath: true;
};

export type AssetEntry = {
  id: string;
  path: string;
  filename: string;
  label: string;
  basename: string;
  extension: string;
  directory: string;
  folder: AssetFolderDescriptor;
  scope: AssetScope;
  stem: string | null;
  kind: AssetKind;
  size: number;
  mtime: number;
  urls: AssetUrlSet;
  capabilities: AssetCapabilities;
};

export type AssetListResponse = AssetEntry[];

export type AssetUploadResponse = AssetEntry;

export type AssetDeleteRequest = {
  path: string;
};

export type AssetDeleteResponse = {
  ok: true;
  id: string;
  path: string;
  deletedAt: number;
};
