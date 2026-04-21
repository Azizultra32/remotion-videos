// src/components/SongPicker.tsx
//
// Dropdown for switching between audio tracks in projects/<stem>/. Fetches
// /api/songs on mount. Selecting a track calls store.setTrack() which clears
// the timeline and resets the playhead — the beats-JSON re-fetch happens in
// App.tsx via useBeatData reacting to the new beatsSrc.
//
// Also: "+ New" button to upload a local audio file and bootstrap a new
// project with no CLI. Upload → server streams to tempfile → mv:scaffold →
// mv:analyze detached. Progress streams to StageStrip after auto-switch.
//
// If the picked track has no sibling analysis.json beats, we still switch
// (so the user can audition the audio), but a "no beats" badge is shown
// and the Scrubber's beat overlay will be empty until analysis is run.

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { stemFromAudioSrc } from "../utils/url";

type SongEntry = {
  stem: string;
  audioSrc: string; // "projects/<stem>/audio.mp3"
  beatsSrc: string; // "projects/<stem>/analysis.json"
  hasBeats: boolean;
  hasTimeline?: boolean;
  sizeBytes: number;
};

const humanize = (stem: string): string =>
  stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const SongPicker = () => {
  const audioSrc = useEditorStore((s) => s.audioSrc);
  const setTrack = useEditorStore((s) => s.setTrack);
  const setTrackByStem = useEditorStore((s) => s.setTrackByStem);
  const [songs, setSongs] = useState<SongEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshSongs = async (): Promise<SongEntry[] | null> => {
    try {
      const r = await fetch("/api/songs");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: SongEntry[] = await r.json();
      setSongs(data);
      return data;
    } catch (err) {
      setError(String((err as Error).message ?? err));
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/songs");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: SongEntry[] = await r.json();
        if (cancelled) return;
        setSongs(data);
        if (audioSrc) return;

        const currentProject = await fetch("/api/current-project")
          .then(async (resp) => {
            if (!resp.ok) return null;
            const body = (await resp.json()) as { stem?: string | null };
            return body.stem ?? null;
          })
          .catch(() => null);
        if (cancelled) return;

        if (currentProject) {
          const restored = await setTrackByStem(currentProject);
          if (cancelled || restored) return;
        }

        const fallback = data[0];
        if (fallback) setTrack(fallback.audioSrc, fallback.beatsSrc);
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioSrc, setTrack, setTrackByStem]);

  const stem = stemFromAudioSrc(audioSrc);
  const current = songs?.find((s) => s.stem === stem) ?? null;

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextStem = e.target.value;
    const next = songs?.find((s) => s.stem === nextStem);
    if (!next) return;
    if (next.stem === stem) return;
    setTrack(next.audioSrc, next.beatsSrc);
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-uploading the same file later by resetting the input.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading({ filename: file.name });
    try {
      const r = await fetch("/api/projects/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Audio-Filename": file.name,
        },
        body: file,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      const { stem: newStem } = (await r.json()) as { stem: string };
      // Refresh the dropdown so the new project shows up, then switch.
      const fresh = await refreshSongs();
      const entry = fresh?.find((s) => s.stem === newStem);
      if (entry) {
        setTrack(entry.audioSrc, entry.beatsSrc);
      } else {
        // /api/songs refresh raced with disk creation — build the URLs
        // ourselves; next refresh will pick it up.
        setTrack(
          `projects/${newStem}/audio${file.name.toLowerCase().endsWith(".wav") ? ".wav" : ".mp3"}`,
          `projects/${newStem}/analysis.json`,
        );
      }
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setUploading(null);
    }
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
          disabled={!songs || songs.length === 0 || !!uploading}
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
            cursor: songs && songs.length > 0 && !uploading ? "pointer" : "default",
          }}
        >
          {!songs && <option value="">Loading…</option>}
          {songs && songs.length === 0 && <option value="">No tracks found</option>}
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
          onChange={onFileChosen}
          style={{ display: "none" }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!uploading}
          title="Upload a local audio file to create a new project. Copies into projects/<stem>/, then auto-runs mv:analyze (Setup with beat detection + Phase 1 + Phase 2). ~5-10 min."
          style={{
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: "monospace",
            background: uploading ? "#222" : "#1a3a1a",
            color: uploading ? "#666" : "#afa",
            border: `1px solid ${uploading ? "#333" : "#386"}`,
            borderRadius: 3,
            cursor: uploading ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? "Uploading…" : "+ New"}
        </button>
        {current && !current.hasBeats && !uploading && (
          <span
            title="No sibling analysis.json beats — Scrubber beat overlay will be empty. Run mv:analyze or click Seed beats in the Analysis strip."
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
      {uploading && (
        <div style={{ fontSize: 10, color: "#8cf", fontFamily: "monospace" }}>
          Scaffolding {uploading.filename}… analysis will start automatically.
        </div>
      )}
      {error && <div style={{ fontSize: 10, color: "#f66" }}>Tracks: {error}</div>}
    </div>
  );
};
