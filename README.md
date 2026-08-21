# ModruleSync

> Transplant curated PGPatcher priority orders onto your local mod list.

**Status: not built yet.** This repo exists to host the tool once it's built — see the design work
already done in [`vortex-collection-tools`'s design
folder](https://github.com/awesmdiver/vortex-collection-tools-dev/blob/master/design/SPEC-pgpatcher-priority-merge-tool.md)
for the full spec and approved mockup.

## What it will do

[PGPatcher](https://github.com/hakasapl/PGPatcher) generates PBR/shader-conflict texture patches
across a Skyrim or Fallout 4 mod collection, using a priority order stored in `modrules.json`. A mod
collection author solves that priority order once, using PGPatcher against their own curated
collection, and ships the file alongside the collection. An end-user installs the collection, runs
PGPatcher far enough to generate their own fresh `modrules.json`, and wants to apply the author's
already-solved priorities onto their own file — instead of re-solving the same conflicts by hand.

ModruleSync will be a standalone, zero-backend static page: upload both files, it fuzzy-matches mod
names between them (exact match, then a normalized match, then human-confirmed candidates for
anything left over — nothing fuzzy ever auto-applies), and produces a merged `modrules.json` ready to
drop straight into PGPatcher's own config folder. Nothing uploaded ever leaves your browser.

## Credits

- **[PGPatcher](https://github.com/hakasapl/PGPatcher)** (hakasapl) — the tool this is a companion to.
