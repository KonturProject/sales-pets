---
name: codex-assets
description: Delegate requested sprite or raster asset generation to local Codex and receive verified file paths for integration into this game. Use for generated art, not for finding existing licensed assets or Blender work.
---

Read `docs/agent-exchange.md` for the shared handoff protocol. Preserve the project's existing `CLAUDE.md`, `game-assets`, and `blender-assets` rules where applicable.

For a requested new image, create a request JSON in `work/agent-exchange/requests/` with a unique lowercase `id`, the user's `prompt`, and optional project-relative `references` paths. Include intended view, style, transparency and sprite layout when known; do not invent a whole character specification.

Run from the project root:

```text
python tools/agent-bridge/bridge.py run --project . --request work/agent-exchange/requests/<id>.json
```

The worker writes only its own job workspace. Keep its execution in a background tool/task when the host supports it; poll the `status` command for that job, not whole logs. Do not launch multiple retries automatically or edit a worker's files while it is running.

Only consume a job whose `status` is `ready`. Read its manifest and inspect one selected preview before integration. Copy approved files to the game's asset location, then update the game under its normal rules. Record provenance without inventing a third-party license for generated art. A file handoff does not establish animation continuity or gameplay quality.

If blocked or failed, report the reason from status and the relevant short log excerpt. Native image generation is required by this workflow. Do not silently use separately billed image APIs or replace requested raster art with SVG/code placeholders.
