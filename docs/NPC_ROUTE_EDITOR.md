# NPC route workshop

This development tool lets Jeff design the full weekly routine for all 12 permanent residents.

Open **Pause → World Routes → Edit NPC Routes** in a development build. The button opens a separate page.
Choose a resident and weekday. The editor starts in **Edit route** mode:

- Drag a numbered stop to move the timed activity.
- Click a gold route line to add a diamond bend point, then drag that point to shape the walking line.
- Choose **Add stop**, then click an open Town tile to place a new timed activity there.
- Select any stop to edit its name, activity type, arrival, departure, and reason in the right panel.
- Use **Move map** only when you want to pan. The mouse wheel changes zoom.

The dark instruction bar above the map always describes what the next click will do. **Play** previews the day.

The starter draft now gives all 12 residents seven detailed days. Each day includes private room time, work or chores,
a meal, an errand, social time, personality-led leisure, and a final return home. Room activities vary by weekday.
Because this editor only draws Town, a private room stop appears on that resident's home-door marker.

The workshop has undo, redo, browser draft storage, strict JSON import, and JSON export. It rejects blocked tiles,
overlapping times, invalid home anchors, incomplete residents, and files larger than 1 MB.

The current draft key is `skl-npc-route-editor.draft.v3`. Earlier version-1 and version-2 keys remain untouched.
Each resident's seven private activities include one evening `Daydreaming` stop. The ordinary game presents that
activity discreetly and uses the blurred-heart effect over the resident's authored bed.
The workshop never reads or writes an adventure save.
It also does not change production schedules automatically. Export `shopkeepers-npc-routes.json` and send it
for review. A later implementation pass can install the approved routes.

Tests use the isolated port 5276 and one Chromium worker:

```sh
npx playwright test --config playwright.personality.config.ts --workers=1 tests/npc-route-editor.spec.ts tests/map-editor-safety.spec.ts
```
