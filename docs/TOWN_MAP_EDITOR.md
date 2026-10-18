# Town workshop

The approved 120×110 layout is now the normal Town map. The workshop remains a separate sandbox:
later draft edits do not change adventures, the approved Farm layout, or interiors.
No buildings or resident assignments are final yet.

## Open and arrange

Open `http://localhost:5273/?mapEditor=1&editorMap=town`, or choose **Town** in the Farm workshop.
Pause your original game first if you use the direct link. The original tab remains separate.

- **Move:** drag a clearing or an existing tree or flower. Clearing corners move together.
- **Path / Grass:** paint or remove paths. Each stroke is one undo step.
- **Whole town:** fit the map on screen. **Town center:** return to the plaza.
- Use the wheel to zoom, **Pan** to drag the view, and **Undo / Redo** to revise changes.
- **Save draft** keeps the Town draft in this browser. It does not update normal play.

There are twelve clearings with short plot IDs. These are planning areas, not solid buildings.
Moving one restores the ground beneath it. Plot sizes stay fixed for this first pass.

The river, bridges, cliffs and route mouths stay fixed. Invalid edits show an error and keep
the previous layout. Trees cannot block access to the clearings or travel routes.
This pass moves existing greenery; it does not add or delete objects.

## Connections

The northwest path goes to Farm, southwest to Forest, north to Mountain, and south to Beach.
Each route has a working return in normal play and the disposable preview. Mountain is the outdoor
mine entrance area; the cave then leads into Mines. Two blue outlined **Future connection**
sites reserve space for later travel features. They do not teleport you anywhere.

## Share your layout

**Export** downloads `shopkeepers-town-layout.json`. Send that file to Codex when you like the layout.
Adopting later exported changes into normal play is a separate step. **Import** reads a Town export; it rejects Farm
files and incompatible Town versions without changing the current draft.

**Walk preview** opens a disposable game with your current layout. Tools and travel work,
but the preview cannot read or write adventure slots. Harvesting there does not edit your draft.
Each preview keeps its opening layout. Open another preview to see later changes.

Town and Farm have separate drafts. Switching maps asks before discarding unsaved edits.
**Reset to original** asks for confirmation and supports undo within the editor session.

## Developer boundary

Town uses `skl-map-editor.town-draft.v1` and `skl-map-editor.town-preview.v1`.
Map selection and sandbox protection latch when the page opens. Editing the URL cannot disable
save protection or change the preview map. Production builds disable the workshop.

The authored source is `src/world/maps/town-workshop.json`; `TownMap` composes ordinary clearings,
and `TownLayoutDraft` shares that composition while validating detached edits.
`TownWorkshop` draws bridge decks from existing timber art. No new building
asset is added. Ordinary `getMapData` calls never read Town editor storage.

## Existing adventures

Save version11 adopts the Town layout and Forest return trail once. It keeps legal positions and
moves conflicting furniture, building footprints, soil/crop pairs and pickups to reachable ground.
It preserves counts, rotations and crop progress. A keeper caught by new obstacles resumes at a
safe named arrival. This Town update does not alter Farm or interior state; older saves still run
their previously approved historical migrations first.

Loading and inspecting do not rewrite saved bytes. The first successful save keeps the exact old
envelope at `shopkeeperslegacy.save.backup.pre-town-v11.slot.N` before writing version11. A backup
failure stops the write. This copy survives ordinary slot deletion. The previous pre-Farm backup
also remains separate. Recovery means restoring that exact envelope to its same slot while the
game is closed; loading it applies the migration again without duplicating items.
