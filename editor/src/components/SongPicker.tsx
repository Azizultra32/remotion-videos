// src/components/SongPicker.tsx
//
// Dropdown for switching between audio tracks in public/. Fetches /api/songs
// once on mount. Selecting a track calls store.setTrack() which clears the
// timeline and resets the playhead — the beats-JSON re-fetch happens in
// App.tsx via useBeatData reacting to the new beatsSrc.
//
// If the picked track has no sibling "-beats.json", we still switch (so the
// user can audition the audio), but a "no beats" badge is shown and the
// Scrubber's beat overlay will be empty until analysis is run.

import { useEffect, useState } from "react";
import { useEditorStore } from "../store";

type SongEntry = {
  stem: string;
  audioSrc: string;
  beatsSrc: string;
  hasBeats: boolean;
  sizeBytes: number;
};

const humanize = (stem: string): string =>
  stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const currentStem = (audioSrc: string | null): string | null => {
  if (!audioSrc) return null;
  return audioSrc.replace(/^\//, "").replace(/\.(mp3|wav)$/i, "");
};

export const SongPicker = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const setTrack = useEditorStore((s) => s.setTrack);
  const [songs, setSongs] = useState<SongEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/songs")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SongEntry[]) => {
        if (!cancelled) setSongs(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stem = currentStem(audioSrc);
  const current = songs?.find((s) => s.stem === stem) ?? null;

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStem = e.target.value;
    const next = songs?.find((s) => s.stem === nextStem);
    if (!next) return;
    if (next.stem === stem) return;
    setTrack(next.audioSrc, next.beatsSrc);
  };

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        htmlFor="song-picker"
        style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        Track
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select
          id="song-picker"
          value={stem ?? ""}
          onChange={onChange}
          disabled={!songs || songs.length === 0}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "4px 6px",
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 4,
            color: "#ddd",
            fontSize: 11,
            fontFamily: "inherit",
            cursor: songs && songs.length > 0 ? "pointer" : "default",
          }}
        >
          {!songs && <option value="">Loading…</option>}
          {songs && songs.length === 0 && <option value="">No tracks found</option>}
          {/* If the persisted audioSrc isn't in the scanned list, show it
              as a disabled option so the select doesn't silently jump to
              the first entry. */}
          {songs && stem && !current && (
            <option value={stem} disabled>
              {humanize(stem)} (missing)
            </option>
          )}
          {songs?.map((s) => (
            <option key={s.stem} value={s.stem}>
              {humanize(s.stem)}
              {s.hasBeats ? "" : " — no beats"}
            </option>
          ))}
        </select>
        {current && !current.hasBeats && (
          <span
            title="No sibling <stem>-beats.json — Scrubber beat overlay will be empty."
            style={{
              fontSize: 9,
              padding: "2px 6px",
              background: "#3a2a00",
              color: "#ffb74d",
              border: "1px solid #5a4200",
              borderRadius: 3,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            no beats
          </span>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 10, color: "#f66" }}>Tracks: {error}</div>
      )}
    </div>
  );
};
