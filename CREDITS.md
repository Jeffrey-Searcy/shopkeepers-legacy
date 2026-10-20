# Art Credits

## Third-party packs (not in this repo)

These 27 files come from third-party packs. Their licenses do not allow redistribution, so
`.gitignore` keeps them out of the repo. Get each pack from its creator and add the files to
`public/assets/` yourself. Most are crops or rebuilt sheets, not the pack's own file names;
`public/assets/manifest.json` gives each file's frame size.

- **Cute Fantasy RPG** (free version) by **Kenmi** — https://kenmi-art.itch.io/cute-fantasy-rpg
  License: the free version is **non-commercial use only, credit required**. Buy the premium
  license from the link above before any commercial release.
  - `objects/flowers.png`, `objects/rock.png`, `objects/weed.png`, `objects/tree-stump.png`
    (from `Outdoor_Decor_Free`)
  - `objects/tree.png`, `objects/tree-small.png`, `objects/tree-sapling.png` (from `Oak_Tree` and
    `Oak_Tree_Small`)
  - `objects/house-pack.png` (from `House_1_Wood_Base_Blue`)
  - `tilesets/terrain.png`, `tilesets/water.png`, `tilesets/cliff.png` (the pack's path, water and
    cliff tiles, laid out as Wang sheets — tile sets that join edge to edge)
- **Sunnyside World** by **Daniel Diggle** — https://danieldiggle.itch.io/sunnyside
  - `characters/player-walk.png`, `characters/player-idle.png`, `characters/player-cast.png`,
    `characters/player-cardinal.png` (base + hair + tool layers, composited)
  - `ui/sunny-hoe.png`, `ui/sunny-parsnip.png`, `ui/sunny-potato.png`, `ui/sunny-seeds.png`,
    `ui/sunny-stone.png`, `ui/sunny-sword.png`, `ui/sunny-wood.png`
- **Farming tools icons** by **PixelLate** — https://pixel-late.itch.io/farming-tools
  The creator gives the pack away free or pay-what-you-want. Credit is welcome but not required.
  - `ui/pixellate-axe.png`, `ui/pixellate-pickaxe.png`, `ui/pixellate-rod.png`,
    `ui/pixellate-scythe.png`, `ui/pixellate-watering-can.png`

## Project-owned art (in this repo)

All other art in `public/assets/` is the project's own. It is not covered by the code's MIT
License.

- **Painted areas** — Town, eleven town interiors and the jail, Beach, Forest, Gate Plaza, the
  dungeon rooms and the title screen. AI-assisted paintings made for this project. Sources are in
  `docs/art-source/`; `scripts/pack-*-art.py` cuts them to the game grid.
- **The keeper and wardrobe garments** — drawn from pixel maps by `tools/keeper-art/`.
- **Sprites, icons, crops and tiles** — generated for this project with
  **PixelLab** (https://pixellab.ai) and other image tools, then cleaned up by hand or by the
  scripts in `scripts/` (for example `scripts/make-week-one-content-art.py`).
