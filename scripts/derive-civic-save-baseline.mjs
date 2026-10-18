/** Derive exact pre-edit non-Market save envelopes from the captured room contracts and clean Market save. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const SOURCE = new URL('../planning_artifacts/town-interiors-market-proof/compatibility/baseline.json', import.meta.url);
const OUTPUT = new URL('../planning_artifacts/town-interiors-complete/compatibility/baseline.json', import.meta.url);

const source = JSON.parse(await readFile(SOURCE, 'utf8'));
const seedEnvelope = JSON.parse(source.market.rawSave);
const rooms = {};
let index = 0;
for (const [id, room] of Object.entries(source.rooms)) {
  const entry = room.geometry.spawns.find(spawn => spawn.id === 'entry');
  if (!entry) throw new Error(`Civic save baseline: ${id} entry is missing`);
  const position = { x: entry.tx * 16 + 8, y: entry.ty * 16 + 8, facing: 'down', stamina: 100 };
  const envelope = structuredClone(seedEnvelope);
  envelope.savedAt = 946684900000 + index;
  const warpTarget = id === 'magic' ? 'TownMagicScene' : id === 'bar' ? 'TownBarScene'
    : id === 'fishing' ? 'TownFishingShopScene' : `Town${id[0].toUpperCase()}${id.slice(1)}Scene`;
  envelope.state.activeScene = warpTarget;
  envelope.state.player = position;
  rooms[id] = { ...room, position, rawSave: JSON.stringify(envelope) };
  index++;
}
await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ capturedAt: new Date().toISOString(), rooms, signatures: source.roomSignatures }, null, 2)}\n`, 'utf8');
process.stdout.write(`${OUTPUT.pathname}\n${Object.keys(rooms).join(', ')}\n`);
