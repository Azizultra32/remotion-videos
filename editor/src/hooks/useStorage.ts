import { useCallback, useEffect, useState } from "react";

// Per-project-scoped localStorage persistence for editor UI state.
// Pattern lifted from Motion Canvas packages/ui/src/hooks/useStorage.ts (MIT).

const scopedKey = (key: string, scope?: string) => (scope ? `${scope}:${key}` : key);

export const storageGet = <T>(key: string, fallback: T, scope?: string): T => {
  try {
    const raw = localStorage.getItem(scopedKey(key, scope));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const storageSet = <T>(key: string, value: T, scope?: string): void => {
  try {
    localStorage.setItem(scopedKey(key, scope), JSON.stringify(value));
  } catch {
    // quota exceeded or storage unavailable — silent by design
  }
};

export const storageClear = (key: string, scope?: string): void => {
  try {
    localStorage.removeItem(scopedKey(key, scope));
  } catch {
    // ignore
  }
};

export function useStorage<T>(
  key: string,
  defaultValue: T,
  scope?: string,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => storageGet(key, defaultValue, scope));

  useEffect(() => {
    storageSet(key, value, scope);
  }, [key, scope, value]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof v === "function" ? (v as (p: T) => T)(prev) : v));
  }, []);

  return [value, set];
}
