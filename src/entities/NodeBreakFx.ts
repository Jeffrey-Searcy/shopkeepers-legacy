/**
 * NodeBreakFx — the look of hitting and breaking a resource node (tree, stump, rock, weed).
 *
 * Everything here is decoration: the game logic (hp, drops, the stump left behind, saved clearings) has
 * already happened in InteractionSystem / BaseWorldScene by the time these run, so tests and saves never
 * wait on an animation. The effects use the node's OWN art — a copy of its exact texture frame (painted
 * Forest/Beach frames included) tips over, sinks or splits into quarters — plus small Phaser Rectangle
 * chips and Arc dust puffs. No textures are generated (generateTexture stalls WebGL in headless runs).
 *
 *  - hitFx:     every tool hit — wood chips from a trunk, a few drifting leaves, stone chips and dust.
 *  - fellFx:    a full or young tree is cut down — the tree tips over away from the keeper and lands with
 *               leaves and dust (timed with Sfx 'fell', FELL_THUMP_S).
 *  - shatterFx: a rock breaks — its art splits into four quarters that tumble apart and fade.
 *  - poofFx:    a stump, sapling or weed is cleared — it sinks into the ground with a little spray.
 *
 * With the reduced-motion setting on, nothing tips, spins or flies far: the copies just fade and the
 * chip sprays are smaller.
 */
import Phaser from 'phaser';
import { TILE, tileToWorld } from '../config/GameConfig';
import type { SceneKey } from '../config/AssetKeys';
import { FELL_THUMP_S } from '../systems/SfxSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { TreeSystem } from '../systems/TreeSystem';
import type { ResourceNode } from './ResourceNode';

/** Milliseconds a felled tree takes to tip over; it matches the thump in Sfx 'fell'. */
export const FELL_MS = FELL_THUMP_S * 1000;

/** Chip palettes, picked to sit inside the game's warm painted colors. */
const WOOD = [0xc89a5e, 0xa8743f, 0xe2c08a] as const;
const OAK_LEAVES = [0x4f8f3a, 0x6fae46, 0x3a6e2e] as const;
const PINE_LEAVES = [0x2f5d3a, 0x3f7a4a, 0x2a4f33] as const;
// why: matched to the rock art's mid and shadow greys; lighter chips piled up over the rock and read as white.
const STONE = [0x7d8597, 0x5f6678, 0x8f97aa] as const;
const WEED = [0x7fae4a, 0x9cc35a, 0x5f8a36] as const;
/** Dust is a muted earth tone at low alpha, so a puff reads as soft dirt, not a white flash on grass. */
const DUST = 0xb8a47e;

/** How one chip flies: start point, speed (px/s), gravity (px/s²), size and life. */
interface ChipSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: number;
  lifeMs: number;
  depth: number;
  /** Leaves sway side to side as they fall instead of arcing like a chip. */
  sway?: boolean;
}

/** A random number in [lo, hi). */
function between(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** One random entry of a palette. */
function pick(palette: readonly number[]): number {
  return palette[Math.floor(Math.random() * palette.length)];
}

/** True when the player asked for less motion: copies fade in place and sprays shrink. */
function calm(): boolean {
  return SettingsSystem.prefersReducedMotion();
}

/**
 * Fly one chip (a tiny square) along a short arc, spinning, and fade it in its last 40%.
 * @param scene the world scene; the chip dies with it if the keeper leaves mid-flight
 * @param spec where it starts, how it moves and how it looks
 */
function chip(scene: Phaser.Scene, spec: ChipSpec): void {
  const rect = scene.add.rectangle(spec.x, spec.y, spec.size, spec.size, spec.color).setDepth(spec.depth);
  const spin = between(-540, 540);
  const phase = between(0, Math.PI * 2);
  scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: spec.lifeMs,
    onUpdate: (tween) => {
      const p = tween.progress;
      const t = (p * spec.lifeMs) / 1000;
      if (spec.sway) {
        // why: a leaf drifts — it slows quickly, then falls gently while swinging side to side.
        rect.x = spec.x + spec.vx * Math.min(t, 0.25) + Math.sin(t * 7 + phase) * 3;
        rect.y = spec.y + spec.vy * Math.min(t, 0.2) + spec.gravity * t;
      } else {
        rect.x = spec.x + spec.vx * t;
        rect.y = spec.y + spec.vy * t + 0.5 * spec.gravity * t * t;
      }
      rect.angle = spin * t;
      rect.alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    },
    onComplete: () => rect.destroy(),
  });
}

/**
 * A soft dust puff: a pale circle that swells and fades.
 * @param scene the world scene
 * @param x puff center
 * @param y puff center
 * @param depth draw depth (just over the node it came from)
 * @param radius starting radius in px
 */
function puff(scene: Phaser.Scene, x: number, y: number, depth: number, radius: number): void {
  const dot = scene.add.circle(x, y, radius, DUST, 0.3).setDepth(depth);
  scene.tweens.add({
    targets: dot,
    scale: calm() ? 1.2 : 1.8,
    alpha: 0,
    y: y - 3,
    duration: 380,
    ease: 'Quad.Out',
    onComplete: () => dot.destroy(),
  });
}

/** Where a node stands: its foot (bottom center of its one tile), never its (possibly wobbling) sprite x. */
function footOf(node: ResourceNode): { x: number; y: number } {
  const c = tileToWorld(node.tx, node.ty);
  return { x: c.x, y: c.y + TILE / 2 };
}

/** The leaf palette of the tree at a node's tile. */
function leavesOf(node: ResourceNode): readonly number[] {
  return TreeSystem.speciesAt(node.scene.scene.key as SceneKey, node.tx, node.ty) === 'pine' ? PINE_LEAVES : OAK_LEAVES;
}

/** The side (−1 left, +1 right) facing away from the keeper, so chips and falling trees go away from them. */
function awayFrom(foot: { x: number }, keeperX: number): -1 | 1 {
  return keeperX <= foot.x ? 1 : -1;
}

/**
 * A copy of a node's exact art (same texture frame, origin, size and depth), for an effect to move while
 * the real node is destroyed and the game carries on.
 */
function artCopy(node: ResourceNode): Phaser.GameObjects.Image {
  const foot = footOf(node);
  return node.scene.add.image(foot.x, foot.y, node.texture.key, node.frame.name)
    .setOrigin(node.originX, node.originY)
    .setDisplaySize(node.displayWidth, node.displayHeight)
    .setFlipX(node.flipX)
    // why: just over the node's own depth, so the falling tree draws over the stump that replaces it.
    .setDepth(node.depth + 0.5);
}

/** How far above its foot a node's art reaches, in world px. */
function heightOf(node: ResourceNode): number {
  return node.displayHeight * node.originY;
}

/**
 * The look of one tool hit on a node that is still standing (or about to break — it runs on every hit).
 * @param node the node that was hit
 * @param keeperX the keeper's x, so chips fly away from them
 */
export function hitFx(node: ResourceNode, keeperX: number): void {
  const scene = node.scene;
  const foot = footOf(node);
  const away = awayFrom(foot, keeperX);
  const depth = node.depth + 0.5;
  const few = calm() ? 0.5 : 1;
  const trunkY = foot.y - 7;
  if (node.kind === 'tree' || node.kind === 'stump') {
    const chips = Math.round((node.kind === 'stump' ? 4 : 5) * few);
    for (let i = 0; i < chips; i++) {
      chip(scene, {
        x: foot.x - away * 3, y: trunkY + between(-3, 3),
        vx: -away * between(25, 70), vy: between(-90, -40), gravity: 320,
        size: Math.random() < 0.3 ? 2 : 1.5, color: pick(WOOD), lifeMs: between(320, 480), depth,
      });
    }
    // A grown tree sheds a couple of leaves from its crown on each chop.
    if (node.kind === 'tree' && node.stage !== 'sapling') {
      const h = heightOf(node);
      const leaves = Math.round((node.stage === 'full' ? 3 : 2) * few);
      for (let i = 0; i < leaves; i++) {
        chip(scene, {
          x: foot.x + between(-0.3, 0.3) * node.displayWidth, y: foot.y - h * between(0.55, 0.85),
          vx: between(-20, 20), vy: between(-10, 5), gravity: 18,
          size: 2, color: pick(leavesOf(node)), lifeMs: between(700, 1000), depth, sway: true,
        });
      }
    }
    return;
  }
  if (node.kind === 'rock') {
    const chips = Math.round(5 * few);
    for (let i = 0; i < chips; i++) {
      chip(scene, {
        x: foot.x + between(-4, 4), y: foot.y - heightOf(node) * 0.45,
        vx: -away * between(15, 60) + between(-15, 15), vy: between(-100, -50), gravity: 360,
        size: Math.random() < 0.4 ? 2 : 1.5, color: pick(STONE), lifeMs: between(300, 450), depth,
      });
    }
    puff(scene, foot.x - away * 3, foot.y - 4, depth, 3);
    return;
  }
  // A weed: a few green flecks.
  for (let i = 0; i < Math.round(3 * few); i++) {
    chip(scene, {
      x: foot.x + between(-3, 3), y: foot.y - 5,
      vx: between(-30, 30), vy: between(-70, -30), gravity: 260,
      size: 1.5, color: pick(WEED), lifeMs: between(280, 400), depth,
    });
  }
}

/**
 * A full or young tree is cut down: a copy of its art tips over away from the keeper and lands with a
 * shower of leaves and dust, then fades. The real node is already gone (and a full tree's stump is in place).
 * @param node the tree node, still alive (call this before destroying it)
 * @param keeperX the keeper's x, so the tree falls away from them
 */
export function fellFx(node: ResourceNode, keeperX: number): void {
  const scene = node.scene;
  const foot = footOf(node);
  const away = awayFrom(foot, keeperX);
  const tree = artCopy(node);
  const h = heightOf(node);
  const leaves = leavesOf(node);
  const depth = tree.depth;
  if (calm()) {
    scene.tweens.add({ targets: tree, alpha: 0, duration: 260, onComplete: () => tree.destroy() });
    puff(scene, foot.x, foot.y - 3, depth, 4);
    return;
  }
  tree.setAngle(away * 2);
  scene.tweens.add({
    targets: tree,
    angle: away * 84,
    duration: FELL_MS,
    // why: Quad.In starts slow and speeds up, like a real trunk giving way, then it stops dead on the ground.
    ease: 'Quad.In',
    onComplete: () => {
      // The crown lands: leaves burst where it hits, dust rolls along the trunk.
      const crownX = foot.x + away * h * 0.65;
      for (let i = 0; i < 9; i++) {
        chip(scene, {
          x: crownX + between(-0.25, 0.25) * h, y: foot.y - between(2, 12),
          vx: between(-30, 30) + away * 10, vy: between(-60, -20), gravity: 40,
          size: 2, color: pick(leaves), lifeMs: between(700, 1100), depth: depth + 0.1, sway: true,
        });
      }
      for (let i = 0; i < 3; i++) puff(scene, foot.x + away * h * (0.3 + i * 0.25), foot.y - 2, depth + 0.1, 4);
      // A small settle bounce, then the fallen tree fades away (the logs it dropped stay).
      scene.tweens.add({
        targets: tree,
        angle: away * 80,
        duration: 110,
        yoyo: true,
        ease: 'Sine.Out',
        onComplete: () => {
          scene.tweens.add({ targets: tree, alpha: 0, duration: 420, delay: 200, onComplete: () => tree.destroy() });
        },
      });
    },
  });
}

/**
 * A rock breaks: its art splits into four quarters (crops of the same frame) that tumble apart, drop and
 * fade, with stone chips and dust.
 * @param node the rock node, still alive (call this before destroying it)
 * @param keeperX the keeper's x, so most pieces roll away from them
 */
export function shatterFx(node: ResourceNode, keeperX: number): void {
  const scene = node.scene;
  const foot = footOf(node);
  const away = awayFrom(foot, keeperX);
  const depth = node.depth + 0.5;
  const fw = node.frame.width, fh = node.frame.height;
  const halfW = Math.floor(fw / 2), halfH = Math.floor(fh / 2);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      // why: each piece is a full-size copy cropped to one quarter, so it shows exactly that part of the rock
      // and moving the copy moves that quarter.
      const piece = artCopy(node).setCrop(qx * halfW, qy * halfH, qx ? fw - halfW : halfW, qy ? fh - halfH : halfH);
      const side = qx ? 1 : -1;
      const top = qy === 0;
      if (calm()) {
        scene.tweens.add({ targets: piece, alpha: 0, duration: 240, onComplete: () => piece.destroy() });
        continue;
      }
      const vx = side * between(18, 34) + away * 8;
      const vy = top ? between(-70, -45) : between(-30, -15);
      const spin = side * between(40, 110);
      scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 460,
        onUpdate: (tween) => {
          const p = tween.progress;
          const t = p * 0.46;
          piece.x = foot.x + vx * t;
          // why: the pieces hop and land back near the foot line (gravity pulls them past their start).
          piece.y = foot.y + Math.min(vy * t + 0.5 * 420 * t * t, top ? 10 : 4);
          piece.angle = spin * t;
          piece.alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
        },
        onComplete: () => piece.destroy(),
      });
    }
  }
  const mid = foot.y - heightOf(node) * 0.4;
  for (let i = 0; i < (calm() ? 2 : 5); i++) {
    chip(scene, {
      x: foot.x + between(-5, 5), y: mid + between(-3, 3),
      vx: between(-60, 60) + away * 15, vy: between(-110, -50), gravity: 380,
      size: Math.random() < 0.5 ? 2 : 1.5, color: pick(STONE), lifeMs: between(320, 500), depth,
    });
  }
  puff(scene, foot.x, foot.y - 2, depth, 4);
}

/**
 * A stump, sapling or weed is cleared: its art sinks into the ground (squashes down and fades) with a
 * little spray of wood or green.
 * @param node the node, still alive (call this before destroying it)
 */
export function poofFx(node: ResourceNode): void {
  const scene = node.scene;
  const foot = footOf(node);
  const copy = artCopy(node);
  const depth = copy.depth;
  scene.tweens.add({
    targets: copy,
    scaleY: calm() ? copy.scaleY : copy.scaleY * 0.2,
    alpha: 0,
    duration: 260,
    ease: 'Quad.In',
    onComplete: () => copy.destroy(),
  });
  const palette = node.kind === 'weed' ? WEED : node.kind === 'stump' ? WOOD : leavesOf(node);
  for (let i = 0; i < (calm() ? 2 : 5); i++) {
    chip(scene, {
      x: foot.x + between(-4, 4), y: foot.y - 4,
      vx: between(-40, 40), vy: between(-80, -35), gravity: 300,
      size: Math.random() < 0.3 ? 2 : 1.5, color: pick(palette), lifeMs: between(300, 450), depth,
    });
  }
  puff(scene, foot.x, foot.y - 2, depth, 3);
}
