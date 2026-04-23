#!/usr/bin/env tsx

import { resolve } from "node:path";
import {
  formatReconcileAssetsResult,
  parseReconcileAssetsArgs,
  reconcileAssets,
} from "./reconcile-assets-core";

const repoRoot = resolve(__dirname, "..", "..");

const main = async (): Promise<void> => {
  const args = parseReconcileAssetsArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("usage: mv:reconcile --project <stem> [--dry-run]");
    process.exit(1);
  }

  const result = await reconcileAssets({
    repoRoot,
    stem: args.project,
    dryRun: args.dryRun,
    onWarn: (message) => console.warn(message),
  });

  for (const line of formatReconcileAssetsResult(result)) {
    console.log(line);
  }
};

void main().catch((error) => {
  console.error("[mv:reconcile] failed:", error);
  process.exit(1);
});
