# CLAUDE.md — ModruleSync

Guidance for Claude Code in this repo. Sits under `skyrim-modding\`, so the workspace root
`F:\Claude Workspace\CLAUDE.md` standing orders apply too (two-seat design/build workflow, voice
guidelines, commit discipline).

## What this is

**ModruleSync** — "Transplant curated PGPatcher priority orders onto your local mod list." A
standalone, zero-backend static web page (no framework, no build step, no npm dependencies) that lets
an end-user apply a mod collection author's own curated
[PGPatcher](https://github.com/hakasapl/PGPatcher) `modrules.json` priority order onto their own
freshly-generated file. Everything happens client-side — nothing uploaded ever leaves the browser.

Full design history lives in the sibling `vortex-collection-tools` repo, since that's where this idea
originated and got spec'd/mocked/named before this repo existed:

- **Spec**: `vortex-tools/vortex-collection-tools/design/SPEC-pgpatcher-priority-merge-tool.md` —
  matching algorithm (4 confidence tiers), the canonical-name rule, merge scope, UI flow, why this has
  to be static-only. Independently verified against PGPatcher's own real source.
- **Mockup**: `vortex-tools/vortex-collection-tools/design/mockup-pgpatcher-priority-merge-tool.html`
  — director-approved visual reference for every screen.
- **Naming**: `vortex-tools/vortex-collection-tools/design/gemini-priority-merge-tool-naming-response.md`
  — the real Gemini pass this name came from.

## Static-only is a hard requirement, not a preference

The whole point of this tool is that the only thing an end-user in this flow is guaranteed to have is
PGPatcher itself — never assume a backend, an account, or any dependency on `vortex-collection-tools`'
own Node/Express app. Plain `FileReader`/`JSON.parse` to read uploads, a plain JS module for the
matching engine, native HTML5 drag-and-drop for the sort screen, a client-side `Blob` + download link
for the result.

## Doc ownership (same split as every project in this workspace)

Design side owns `README.md` (user-facing) — terminal doesn't rewrite its voice, flag changes in the
handoff instead. `TECHNICAL.md` gets created once there's real technical content to document (the
matching engine, the merge format) — not yet, since nothing's built here.

## End every task with a handoff

Per the workspace's own two-seat workflow, write a wrap-up to this repo's own
`prompts/handoff-latest.md` (overwrite each time — ephemeral, gitignore it once real history exists,
matching every other tracked project in this workspace).
