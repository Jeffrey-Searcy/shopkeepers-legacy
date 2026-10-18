/** Reproduce the isolated town's authored JSON on stdout; caller reviews and applies the data diff. */
const w = 120, h = 110;
const ground = Array.from({ length: h }, () => Array(w).fill('grass'));
const paths = new Set(), reserved = new Set();
const plots = [
  { id: 'plot:01', tx: 16, ty: 37, w: 11, h: 9 },
  { id: 'plot:02', tx: 17, ty: 58, w: 9, h: 8 },
  { id: 'plot:03', tx: 25, ty: 68, w: 11, h: 8 },
  { id: 'plot:04', tx: 53, ty: 63, w: 12, h: 9 },
  { id: 'plot:05', tx: 61, ty: 39, w: 12, h: 10 },
  { id: 'plot:06', tx: 99, ty: 25, w: 11, h: 9 },
  { id: 'plot:07', tx: 99, ty: 46, w: 10, h: 8 },
  { id: 'plot:08', tx: 98, ty: 70, w: 13, h: 10 },
  { id: 'plot:09', tx: 14, ty: 97, w: 12, h: 7 },
  { id: 'plot:10', tx: 53, ty: 98, w: 12, h: 7 },
  { id: 'plot:11', tx: 74, ty: 95, w: 12, h: 9 },
  { id: 'plot:12', tx: 96, ty: 94, w: 14, h: 10 },
];
const bridges = [
  { id: 'bridge:north', tx: 80, ty: 35, w: 16, h: 4, axis: 'horizontal' },
  { id: 'bridge:east', tx: 77, ty: 59, w: 18, h: 4, axis: 'horizontal' },
  { id: 'bridge:south', tx: 40, ty: 81, w: 4, h: 16, axis: 'vertical' },
];
const futureSites = [
  { id: 'future:transit', tx: 57, ty: 8, w: 8, h: 6 },
  { id: 'future:sewer', tx: 7, ty: 78, w: 6, h: 5 },
];
const spawns = [
  { id: 'start', tx: 42, ty: 52 }, { id: 'from_farm', tx: 4, ty: 30 },
  { id: 'from_forest', tx: 4, ty: 73 }, { id: 'from_mountain', tx: 43, ty: 4 },
  { id: 'from_beach', tx: 42, ty: 105 },
];
const warps = [
  { tx: 0, ty: 28, w: 1, h: 5, target: 'FarmScene', spawn: 'from_town' },
  { tx: 0, ty: 71, w: 1, h: 5, target: 'ForestScene', spawn: 'from_town' },
  { tx: 41, ty: 0, w: 5, h: 1, target: 'MountainScene', spawn: 'from_town' },
  { tx: 40, ty: 109, w: 5, h: 1, target: 'BeachScene', spawn: 'from_town' },
];

/** Visit a clipped tile rectangle, optionally with a margin; used for clear route reservations. */
function eachRect(rect, margin, visit) {
  for (let y = Math.max(0, rect.ty - margin); y < Math.min(h, rect.ty + rect.h + margin); y++) {
    for (let x = Math.max(0, rect.tx - margin); x < Math.min(w, rect.tx + rect.w + margin); x++) visit(x, y);
  }
}

/** Distance from a tile center to a river centerline segment, including its rounded ends. */
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

// A long eastern river turns west across the southern town; three crossings connect its banks.
const river = [[88, -5], [89, 24], [86, 47], [84, 64], [78, 75], [65, 85], [47, 89], [-5, 89]];
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (river.slice(1).some((point, index) => segmentDistance(x, y, river[index], point) < 4.2)) ground[y][x] = 'water';
}
for (const bridge of bridges) eachRect(bridge, 0, (x, y) => { ground[y][x] = 'grass'; });

/** Test neighboring terrain before adding another Wang lower terrain; keep a one-cell grass buffer. */
function nearLower(x, y, kinds) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w && kinds.includes(ground[y + dy][x + dx])) return true;
  }
  return false;
}

/** Identify the generous open route mouth around one of the four real external links. */
function exitOpening(x, y) {
  return (x < 7 && ((y >= 26 && y <= 34) || (y >= 69 && y <= 77))) ||
    (y < 7 && x >= 39 && x <= 47) || (y >= 103 && x >= 38 && x <= 46);
}
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const ring = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
  const northernHill = y >= 19 && y <= 21 && ((x >= 8 && x <= 31) || (x >= 55 && x <= 73));
  if ((ring || northernHill) && !exitOpening(x, y) && !nearLower(x, y, ['water'])) ground[y][x] = 'cliff';
}

/** Author a calm dirt road and reserve its grass shoulders from tree scatter. */
function road(x, y, width, height) {
  eachRect({ tx: x, ty: y, w: width, h: height }, 2, (tx, ty) => paths.add(`${tx},${ty}`));
  eachRect({ tx: x, ty: y, w: width, h: height }, 0, (tx, ty) => {
    if (ground[ty][tx] === 'grass' && !nearLower(tx, ty, ['water', 'cliff'])) ground[ty][tx] = 'dirt';
  });
}
road(0, 29, 45, 3); road(42, 0, 3, 58); road(10, 50, 68, 3); road(31, 47, 22, 10);
road(0, 72, 12, 3); road(10, 51, 3, 24); road(40, 53, 4, 57);
// The vertical access road runs east of plot:05, never through a future building footprint.
road(65, 35, 50, 3); road(75, 35, 3, 25); road(43, 59, 72, 3);
road(113, 20, 3, 64); road(10, 105, 105, 2);
// Small park paths make the northern rise useful, while leaving its broad lawn open.
road(26, 11, 20, 2); road(26, 11, 2, 7); road(43, 15, 9, 2);

for (const warp of warps) eachRect(warp, 3, (x, y) => reserved.add(`${x},${y}`));
for (const spawn of spawns) eachRect({ ...spawn, w: 1, h: 1 }, 1, (x, y) => reserved.add(`${x},${y}`));
for (const bridge of bridges) eachRect(bridge, 1, (x, y) => reserved.add(`${x},${y}`));
for (const site of futureSites) eachRect(site, 1, (x, y) => reserved.add(`${x},${y}`));
const scatterExcluded = new Set([...reserved, ...paths]);
for (const plot of plots) eachRect(plot, 2, (x, y) => scatterExcluded.add(`${x},${y}`));

let seed = 18092026;
/** Deterministic authoring RNG, unrelated to a user's gameplay seed or save. */
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
const objects = [], decor = [], occupied = new Set();
for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) {
  if (ground[y][x] !== 'grass' || scatterExcluded.has(`${x},${y}`)) continue;
  const grove = (x < 28 && y < 27) || (x > 53 && x < 76 && y < 30) ||
    (x < 22 && y > 53 && y < 85) || (x > 93 && y < 19);
  const chance = grove ? 0.19 : 0.018;
  // Small gaps between trunks preserve walking routes while native canopies form readable clumps.
  if (random() < chance && !occupied.has(`${x - 1},${y}`) && !occupied.has(`${x},${y - 1}`)) {
    objects.push({ kind: 'tree', tx: x, ty: y }); occupied.add(`${x},${y}`);
  } else if (random() < (grove ? 0.045 : 0.012)) {
    decor.push({ kind: random() < 0.48 ? 'bush' : 'flowers', tx: x, ty: y }); occupied.add(`${x},${y}`);
  }
}
const solid = ground.map((row, y) => row.map((cell, x) => cell === 'water' || cell === 'cliff' || x === 0 || y === 0 || x === w - 1 || y === h - 1));
const buildable = ground.map(() => Array(w).fill(false));
const map = { key: 'TownScene', w, h, ground, solid, buildable, spawns, warps, objects, decor, buildings: [],
  reservedTiles: [...reserved].map(key => { const [tx, ty] = key.split(',').map(Number); return { tx, ty }; }),
  townPlan: { plots, bridges, futureSites } };
// Plots are composited by the draft compiler, not baked into this underlying terrain. Moving a
// plot therefore restores its old grass/path faithfully rather than leaving a dirt footprint.
process.stdout.write(JSON.stringify(map));
