# Engine-level shared assets

Files here are accessible from any project or track via `staticFile("assets/...")`.

Structure:
- `public/assets/images/` — shared images (logos, textures, backgrounds)
- `public/assets/videos/` — shared video clips

Per-project private assets still live at `projects/<stem>/images/` and
`projects/<stem>/videos/` — those are gitignored with the rest of the project.

This directory is gitignored (except for this README + subfolder .gitkeep).
Drop files in, use them from the editor's Pick Files button in ElementDetail.
