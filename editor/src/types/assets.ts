export type AssetKind = "image" | "video" | "gif";

export type AssetScope = "global" | "project";

export type AssetEntry = {
  path: string;
  scope: AssetScope;
  stem: string | null;
  kind: AssetKind;
  size: number;
  mtime: number;
};
