---
name: asset-exchange
description: Continue shared Claude Code and Codex asset jobs using the project's common manifests and file handoff protocol. Use when moving asset work between the two interfaces.
---

Read `docs/agent-exchange.md` and the existing project `CLAUDE.md` before taking over a task. Shared files hold job state; this does not synchronize chat histories.

Check existing job statuses in `work/agent-exchange/jobs/`. Do not take ownership of a running job or start a second coordinator over the same files. Reuse selected ready assets and their manifests.

When generating directly in Codex, use its native image generation skill/tool. Keep new outputs separate from game files until the coordinating agent integrates them. Do not invoke another Codex worker recursively. Preserve the request's style, references and metadata, and report actual paths and dimensions. Follow the shared manifest format for handoff.

Do not auto-fallback to an image API or assume that Claude's tools, authorizations, sessions or internal memory are available in this session.
