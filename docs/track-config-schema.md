# Per-Track Analysis Config Schema

Optional JSON file co-located with the audio — `public/<stem>-config.json`.
Every field is optional. Any field left unset falls back to the hardcoded
default in the analysis script. The config file exists so you can nudge a
single track's detection without editing Python.

All scripts in `scripts/analyze-audio.sh` pick up this config via
`--config public/<stem>-config.json`. The orchestrator passes it
automatically when the file exists at that path.

## Example

```json
{
  "track": "love-in-traffic",
  "notes": "Deep house — widen bass band slightly, longer breakdowns OK.",
  "beats": {
    "extend_intro": true,
    "use_madmom": true
  },
  "drops": {
    "bass_band_hz": [60, 250],
    "highs_band_hz": [2000, 8000],
    "air_band_hz": [8000, 16000],
    "bars_per_breakdown_min": 8,
    "bars_per_buildup_min": 4,
    "structure_delta_db_min": 6.0,
    "struct_percentiles": [25, 50, 70],
    "novelty_kernel_bars": 16,
    "novelty_peak_min_distance_bars": 8
  },
  "energy": {
    "decay": 2.5,
    "onset_hop_ms": 11.6
  },
  "spectrum": {
    "bands": 16,
    "freq_range_hz": [30, 10000],
    "local_window_sec": 3.0
  }
}
```

## Field reference

### `track` — string, display name
Purely informational. Printed in pipeline logs so you can tell configs
apart at a glance.

### `notes` — string
Free-form. Ignored by code; useful for "why did I tune this."

### `beats`

| Field | Type | Default | Effect |
|---|---|---|---|
| `extend_intro` | bool | `true` | Backfill beats before the first detected beat using the locked BPM. |
| `use_madmom` | bool | `true` | Use madmom's RNN+HMM downbeat detector. If false → librosa[::4]. |

### `drops`

| Field | Type | Default | Effect |
|---|---|---|---|
| `bass_band_hz` | `[lo, hi]` | `[80, 250]` | Bass-band mask for banded RMS. |
| `highs_band_hz` | `[lo, hi]` | `[2000, 8000]` | Highs-band mask. |
| `air_band_hz` | `[lo, hi]` | `[8000, 16000]` | Air-band mask. |
| `bars_per_breakdown_min` | int | `8` | Breakdown = ≥N consecutive low-struct bars. |
| `bars_per_buildup_min` | int | `4` | Buildup = ≥N consecutive rising-HF-slope bars. |
| `structure_delta_db_min` | float | `6.0` | Guardrail: if struct_p70 − struct_p25 is smaller than this, skip detection. |
| `struct_percentiles` | `[p_lo, p_mid, p_hi]` | `[25, 50, 70]` | Percentile triple for struct_per_bar. |
| `novelty_kernel_bars` | int | `16` | Half-width of the Foote checkerboard kernel. |
| `novelty_peak_min_distance_bars` | int | `8` | Minimum bar spacing between novelty peaks. |

### `energy`

| Field | Type | Default | Effect |
|---|---|---|---|
| `decay` | float | `2.5` | Flash lifetime exponent. Higher = flashes die faster. |
| `onset_hop_ms` | float | `11.6` | Hop size for onset detection (~256 samples @ 22050 Hz). |

### `spectrum`

| Field | Type | Default | Effect |
|---|---|---|---|
| `bands` | int | `16` | Number of log-spaced frequency bands. |
| `freq_range_hz` | `[lo, hi]` | `[30, 10000]` | Lowest/highest band edges. |
| `local_window_sec` | float | `3.0` | Rolling window for per-band normalization. |

## How scripts load it

Each analysis script accepts `--config <path>` and uses the same loader:

```python
import json
from pathlib import Path

def load_config(path: str | None, section: str) -> dict:
    """Load the `section` block from a per-track config JSON, or {} if
    no file. Callers read fields via `.get(name, default)`."""
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    data = json.loads(p.read_text())
    return data.get(section, {})
```

- `detect-beats.py` reads `beats` section.
- `detect-drops.py` reads `drops` section.
- `hires-energy.py` reads `energy` section.
- `compute-spectrum.py` reads `spectrum` section.

## Orchestrator behavior

`scripts/analyze-audio.sh public/love-in-traffic.mp3`:

1. Derives `<stem>` = `love-in-traffic`.
2. If `public/<stem>-config.json` exists, passes `--config
   public/<stem>-config.json` to every analysis script.
3. If not, every script uses its built-in defaults.
4. Output files land at `public/<stem>-beats.json`,
   `public/<stem>-energy-<fps>fps.json`,
   `public/<stem>-spectrum-<fps>fps.json` as today.

## Validation

Stage 3 ships a determinism check:

- Run the pipeline twice with the same config → byte-identical JSON.
- Run with a different config (e.g. `bars_per_breakdown_min: 12`) →
  the `breakdowns` output must differ.

That's how "the config does what it says" gets proven without any
hand-tuning to a specific track.
