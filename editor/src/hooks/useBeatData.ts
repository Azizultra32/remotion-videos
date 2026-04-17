// src/hooks/useBeatData.ts
import { useEffect } from "react";
import { useEditorStore } from "../store";
import type { BeatData } from "../types";

export const useBeatData = (url: string) => {
  const setBeatData = useEditorStore((s) => s.setBeatData);
  useEffect(() => {
    fetch(url)
      .then((r) => r.json())
      .then((d: BeatData) => setBeatData(d));
  }, [url, setBeatData]);
};
