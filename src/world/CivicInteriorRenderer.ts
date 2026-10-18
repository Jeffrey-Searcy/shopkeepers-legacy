/**
 * Rich role-specific architecture for the built (procedural) civic rooms. Since the painted interiors
 * landed, only the clinic is built; every other civic room is one painting (see world/CivicRoomArt.ts).
 * Public fixtures remain building-owned; this renderer adds materials, identity, and lived-in east homes.
 */
import Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import type { BuiltCivicBlueprint, CivicTileRect } from '../config/CivicInteriors';

/** Draw one crisp tile field and keep its decorative marks below actors. */
function floorField(scene: Phaser.Scene, area: CivicTileRect, colors: readonly [number, number], name: string): void {
  const x = area.tx * TILE, y = area.ty * TILE, w = area.w * TILE, h = area.h * TILE;
  const g = scene.add.graphics().setDepth(-13).setName(name);
  for (let row = 0; row < area.h; row++) {
    const py = y + row * TILE;
    g.fillStyle(colors[row % 2]).fillRect(x, py, w, TILE);
    g.lineStyle(1, 0x2b2224, 0.32).lineBetween(x, py, x + w, py);
    const offset = row % 2 === 0 ? 0 : TILE * 2;
    for (let px = x + offset; px < x + w; px += TILE * 4) g.lineBetween(px, py, px, py + TILE);
    g.lineStyle(1, 0xf5d69a, 0.12).lineBetween(x, py + 1, x + w, py + 1);
  }
  g.lineStyle(3, 0x2c2224, 0.72).strokeRect(x, y, w, h);
}

/** Add the clinic's leaf marks to the floor without changing collision or using labels. */
function identityPattern(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const g = scene.add.graphics().setDepth(-8.9).setName(`civic-pattern-${room.id}`);
  const left = TILE * 2, right = (room.baseW - 2) * TILE;
  for (let x = left + 18; x < right; x += 52) {
    g.fillStyle(room.theme.accent, 0.18).fillEllipse(x, 190 + (x % 3) * 8, 18, 6);
  }
}

/** Lay out the non-blocking entry runner and the clinic's herb rug. */
function publicZoning(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const g = scene.add.graphics().setDepth(-8.7).setName(`civic-zones-${room.id}`);
  const serviceY = (room.serviceStand.ty + 0.5) * TILE;
  const entryX = (room.entryTx + 0.5) * TILE, entryY = (room.h - 3 + 0.5) * TILE;
  const rug = (x: number, y: number, w: number, h: number, color = room.theme.accent): void => {
    g.fillStyle(room.theme.shadow, 0.22).fillRoundedRect(x + 3, y + 4, w, h, 5);
    g.fillStyle(color, 0.34).fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(3, room.theme.trim, 0.62).strokeRoundedRect(x, y, w, h, 5);
    g.lineStyle(1, room.theme.shadow, 0.45).strokeRoundedRect(x + 6, y + 6, w - 12, h - 12, 3);
  };
  const runnerTop = Math.min(serviceY + 28, entryY - 55);
  rug(entryX - 22, runnerTop, 44, Math.max(42, entryY - runnerTop - 18));

  rug(52, 198, 176, 70, 0xb9b886);
  for (let x = 64; x < 216; x += 30) g.fillStyle(0x6e936d, 0.3).fillCircle(x, 214 + (x % 3) * 12, 7);
}

/** Add warm wall light and framed role motifs without creating hidden collision. */
function wallDetails(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const g = scene.add.graphics().setDepth(52).setName(`civic-wall-details-${room.id}`);
  for (const tx of [3, Math.floor(room.baseW / 2), room.baseW - 4]) {
    const x = tx * TILE + 8;
    g.fillStyle(room.theme.shadow, 0.42).fillRect(x - 5, 34, 12, 3);
    g.fillStyle(0xd79545, 0.95).fillRect(x - 3, 29, 7, 7);
    g.fillStyle(0xffd77c, 0.95).fillTriangle(x - 2, 31, x, 24, x + 3, 31);
    g.fillStyle(room.theme.trim).fillRect(x - 1, 36, 3, 7);
  }
}

/** Draw deep top-wall millwork and the clinic's leaf emblem above the door. */
function publicArchitecture(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const w = (room.baseW - 2) * TILE, g = scene.add.graphics().setDepth(50).setName(`civic-architecture-${room.id}`);
  g.fillStyle(room.theme.shadow).fillRect(16, 7, w, 40);
  g.fillStyle(room.theme.wall).fillRect(20, 10, w - 8, 33);
  g.fillStyle(room.theme.trim).fillRect(20, 40, w - 8, 4);
  for (let x = 24; x < 16 + w - 8; x += 48) g.fillStyle(room.theme.shadow, 0.45).fillRect(x, 12, 4, 27);
  const cx = room.entryTx * TILE + TILE;
  g.fillStyle(room.theme.shadow).fillRoundedRect(cx - 26, 14, 52, 25, 5);
  g.lineStyle(2, room.theme.trim, 0.85).strokeRoundedRect(cx - 23, 17, 46, 19, 4);
  g.fillStyle(room.theme.accent, 0.92);
  g.fillEllipse(cx - 5, 27, 14, 7).fillEllipse(cx + 6, 23, 14, 7); g.lineStyle(2, room.theme.trim).lineBetween(cx, 34, cx, 20);
}

/** Draw one wall segment on the exact solid cells supplied by the room blueprint. */
function wall(scene: Phaser.Scene, area: CivicTileRect, room: BuiltCivicBlueprint, name: string): void {
  const x = area.tx * TILE, y = area.ty * TILE, w = area.w * TILE, h = area.h * TILE;
  const g = scene.add.graphics().setDepth(y + h).setName(name);
  g.fillStyle(room.theme.shadow).fillRect(x, y, w, h);
  g.fillStyle(room.theme.wall).fillRect(x + 3, y, w - 6, h - 4);
  g.fillStyle(room.theme.trim).fillRect(x + 2, y, w - 4, 3).fillRect(x, y + h - 5, w, 3);
}

/** Place one required home asset at native size with its floor contact on a configured footprint. */
function homeAsset(scene: Phaser.Scene, key: TextureKey, x: number, bottom: number, name: string): void {
  if (!scene.textures.exists(key)) throw new Error(`Civic interior: missing home texture ${key}`);
  scene.add.image(x, bottom, key).setOrigin(0.5, 1).setDepth(bottom + 1).setName(name);
}

/** Draw an open side arch through only the three former wall cells permitted by compatibility. */
function sideArch(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const x = (room.baseW - 1) * TILE, g = scene.add.graphics().setDepth(132).setName(`civic-home-arch-${room.id}`);
  g.fillStyle(room.theme.shadow, 0.28).fillRect(x - 6, 78, 28, 54);
  g.fillStyle(room.theme.wall).fillRect(x - 3, 80, 21, 49);
  g.fillStyle(room.theme.trim).fillRect(x, 82, 4, 44);
  g.fillStyle(room.theme.shadow).fillRect(x - 9, 74, 36, 10).fillRect(x - 9, 124, 36, 10);
  g.fillStyle(room.theme.trim).fillRect(x - 6, 77, 30, 3).fillRect(x - 6, 127, 30, 3);
}

/** Render the shared lived-in home wing with room-colored textiles and no public-shop counter. */
function homeWing(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  const base = room.baseW * TILE;
  const rugs = scene.add.graphics().setDepth(-8.8).setName(`civic-home-rugs-${room.id}`);
  rugs.fillStyle(room.theme.accent, 0.62).fillRoundedRect(base + 62, 82, 92, 58, 4);
  rugs.lineStyle(3, room.theme.trim, 0.74).strokeRoundedRect(base + 62, 82, 92, 58, 4);
  rugs.fillStyle(room.theme.accent, 0.52).fillRoundedRect(base + 47, 195, 112, 45, 4);
  rugs.lineStyle(3, room.theme.trim, 0.7).strokeRoundedRect(base + 47, 195, 112, 45, 4);
  const details = scene.add.graphics().setDepth(114).setName(`civic-home-details-${room.id}`);
  details.fillStyle(room.theme.wall).fillRect(base + 3, 40, 169, 7).fillRect(base + 3, 174, 169, 6);
  details.fillStyle(room.theme.trim).fillRect(base + 6, 40, 163, 3).fillRect(base + 6, 174, 163, 2);
  for (const x of [base + 3, base + 168]) details.fillStyle(room.theme.shadow).fillRect(x, 38, 8, 91);
  details.fillStyle(room.theme.shadow).fillRect(base + 65, 15, 38, 23);
  details.fillStyle(room.theme.trim).fillRect(base + 69, 19, 30, 15);
  details.fillStyle(room.theme.accent).fillTriangle(base + 72, 32, base + 84, 21, base + 96, 32);
  homeAsset(scene, TextureKey.MarketStove, base + 32, 80, `civic-${room.id}-stove`);
  homeAsset(scene, TextureKey.MarketCabinet, base + 144, 96, `civic-${room.id}-pantry`);
  homeAsset(scene, TextureKey.MarketTable, base + 112, 112, `civic-${room.id}-table`);
  homeAsset(scene, TextureKey.MarketBed, base + 22, 224, `civic-${room.id}-bed`);
  homeAsset(scene, TextureKey.MarketDresser, base + 138, 224, `civic-${room.id}-dresser`);
  const threshold = room.privateThreshold;
  homeAsset(scene, TextureKey.MarketDoorway, (threshold.tx + threshold.w / 2) * TILE,
    (threshold.ty + 1) * TILE, `civic-${room.id}-bedroom-door`);
}

/**
 * Render one role-specific public room and its connected home before residents and shared fixtures.
 * @param scene Active civic scene.
 * @param room Authored material, geometry, and role identity.
 * @returns Nothing; all display objects remain scene-owned.
 */
export function renderExpandedCivicInterior(scene: Phaser.Scene, room: BuiltCivicBlueprint): void {
  floorField(scene, room.publicRoom, [room.theme.floorA, room.theme.floorB], `civic-${room.id}-public-floor`);
  floorField(scene, room.livingRoom, [0x9b704b, 0x8f6546], `civic-${room.id}-living-floor`);
  floorField(scene, room.bedroom, [0x875b50, 0x7d5149], `civic-${room.id}-bedroom-floor`);
  identityPattern(scene, room);
  publicZoning(scene, room);
  publicArchitecture(scene, room);
  wallDetails(scene, room);
  room.staticWalls.forEach((segment, index) => wall(scene, segment, room, `civic-${room.id}-partition-${index}`));
  sideArch(scene, room);
  homeWing(scene, room);
}
