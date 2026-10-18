/** Authored shop-front geometry shared by drawing, physics, and explicit pre-porch save migration. */
import { TILE, PLAYER_BODY } from './GameConfig';

/** Whole-tile translation from the original shop; zero preserves every authored pixel. */
export interface ShopOffset { tx: number; ty: number }

/** Native pixel measurements of the accepted facade, independent of renderer or save state. */
export const SHOP_FRONT = {
  x: 68 * TILE, y: 82, width: 160,
  door: { x: 1157, y: 167, width: 22, height: 41, centerX: 73 * TILE, sillY: 13 * TILE },
  porch: { x: 69 * TILE, y: 13 * TILE, width: 8 * TILE, height: TILE },
  steps: { x: 72 * TILE, y: 14 * TILE, width: 2 * TILE, height: TILE },
  posts: [{ x: 1106, y: 160, width: 6, height: 64 }, { x: 1224, y: 160, width: 6, height: 64 }],
} as const;

/** Only visible structure blocks walking: stone face beside the steps, side edges and post feet. */
export const SHOP_PORCH_BODIES = [
  { name: 'plinth-left', x: 1104, y: 223, width: 48, height: 9 },
  { name: 'plinth-right', x: 1184, y: 223, width: 48, height: 9 },
  { name: 'edge-left', x: 1104, y: 208, width: 2, height: 15 },
  { name: 'edge-right', x: 1230, y: 208, width: 2, height: 15 },
  { name: 'post-left', x: 1105, y: 220, width: 8, height: 4 },
  { name: 'post-right', x: 1223, y: 220, width: 8, height: 4 },
] as const;

/** Return detached drawing and collision geometry translated by the supplied whole-tile offset. */
export function getShopGeometry(offset: ShopOffset) {
  if (!Number.isSafeInteger(offset.tx) || !Number.isSafeInteger(offset.ty)) {
    throw new Error('Shop offset must contain whole tile coordinates.');
  }
  const dx = offset.tx * TILE, dy = offset.ty * TILE;
  return {
    front: {
      ...SHOP_FRONT, x: SHOP_FRONT.x + dx, y: SHOP_FRONT.y + dy,
      door: { ...SHOP_FRONT.door, x: SHOP_FRONT.door.x + dx, y: SHOP_FRONT.door.y + dy,
        centerX: SHOP_FRONT.door.centerX + dx, sillY: SHOP_FRONT.door.sillY + dy },
      porch: { ...SHOP_FRONT.porch, x: SHOP_FRONT.porch.x + dx, y: SHOP_FRONT.porch.y + dy },
      steps: { ...SHOP_FRONT.steps, x: SHOP_FRONT.steps.x + dx, y: SHOP_FRONT.steps.y + dy },
      posts: SHOP_FRONT.posts.map(post => ({ ...post, x: post.x + dx, y: post.y + dy })),
    },
    bodies: SHOP_PORCH_BODIES.map(part => ({ ...part, x: part.x + dx, y: part.y + dy })),
  };
}

/** Test the actual keeper feet box against newly solid porch structure; touching edges is allowed. */
export function intersectsShopStructure(x: number, y: number, offset: ShopOffset = { tx: 0, ty: 0 }): boolean {
  const halfW = PLAYER_BODY.w / 2;
  const halfH = PLAYER_BODY.h / 2;
  return getShopGeometry(offset).bodies.some(part => x + halfW > part.x && x - halfW < part.x + part.width &&
    y + halfH > part.y && y - halfH < part.y + part.height);
}
