/**
 * ShopFront draws the neutral inherited storefront as separate depth layers.
 * The generated facade stays untouched; native-pixel crops supply porch timber.
 * FarmScene owns collision and scene changes. This class only draws and opens the door.
 */
import Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { getShopGeometry, type ShopOffset } from '../config/Shop';

/** Transient animation state; never written to the player's save. */
export type ShopDoorPhase = 'closed' | 'opening' | 'open';

/**
 * Own the scene-local storefront artwork. Phaser destroys its display objects and timers
 * when the scene shuts down, so returning to Farm creates a fresh closed entrance.
 */
export class ShopFront {
  private readonly door: Phaser.GameObjects.Graphics;
  private phase: ShopDoorPhase = 'closed';
  private readonly front: ReturnType<typeof getShopGeometry>['front'];
  private readonly wall: Phaser.GameObjects.Image;
  private readonly lintel: Phaser.GameObjects.Image;

  /** Build the facade and porch from the manifest-loaded image; do not create collision bodies. */
  constructor(private readonly scene: Phaser.Scene, offset: ShopOffset = { tx: 0, ty: 0 }, textureKey: TextureKey = TextureKey.ShopFacade) {
    this.front = getShopGeometry(offset).front;
    if (!scene.textures.exists(TextureKey.ShopFacade)) {
      throw new Error(`ShopFront: missing required texture "${TextureKey.ShopFacade}"`);
    }
    const texture = scene.textures.get(TextureKey.ShopFacade);
    const source = texture.getSourceImage();
    if (source.width !== 160 || source.height !== 160) {
      throw new Error('ShopFront: shop-facade must retain its authored 160x160 native canvas');
    }
    // Frames survive scene restarts with the texture. Register once, without altering any pixels.
    if (!texture.has('shop-wall')) texture.add('shop-wall', 0, 0, 0, 160, 128);
    if (!texture.has('shop-lintel')) texture.add('shop-lintel', 0, 0, 0, 160, 85);
    if (!texture.has('shop-planks')) texture.add('shop-planks', 0, 24, 131, 112, 6);
    if (!texture.has('shop-post')) texture.add('shop-post', 0, 18, 88, 6, 16);

    this.drawPorch();
    this.wall = scene.add.image(this.front.x, this.front.y, TextureKey.ShopFacade, 'shop-wall')
      .setOrigin(0, 0).setDepth(-6).setName('shop-facade-back');
    // The roof and lintel cover the keeper's head as their feet cross behind the sill.
    // Keep the dark aperture out of this crop so the body can remain visible inside the doorway.
    this.lintel = scene.add.image(this.front.x, this.front.y, TextureKey.ShopFacade, 'shop-lintel')
      .setOrigin(0, 0).setDepth(this.front.door.sillY).setName('shop-door-lintel-front');

    this.door = scene.add.graphics({ x: this.front.door.x, y: this.front.door.y })
      .setDepth(this.front.door.sillY + 1).setName('shop-door-leaf');
    this.drawDoor(22);

    // Unlike the facade, these supports sort at the front edge of the porch. A keeper whose
    // feet are on the deck passes behind each narrow post, not behind an opaque building image.
    for (const [index, post] of this.front.posts.entries()) {
      scene.add.tileSprite(post.x, post.y, post.width, post.height, TextureKey.ShopFacade, 'shop-post')
        .setOrigin(0, 0).setDepth(post.y + post.height).setName(`shop-porch-post-${index}`);
      scene.add.rectangle(post.x - 1, post.y + post.height - 4, post.width + 2, 4, 0x573535)
        .setOrigin(0, 0).setDepth(post.y + post.height).setName(`shop-post-foot-${index}`);
    }
    this.setFacade(textureKey);
  }

  /** Swap only facade layers after validating art. Porch, door animation and all collision remain unchanged. */
  setFacade(textureKey: TextureKey): void {
    if (!this.scene.textures.exists(textureKey)) throw new Error(`ShopFront: missing required texture "${textureKey}"`);
    const texture = this.scene.textures.get(textureKey);
    const source = texture.getSourceImage();
    if (source.width !== 160 || source.height !== 160) throw new Error(`ShopFront: ${textureKey} must be 160x160`);
    if (!texture.has('shop-wall')) texture.add('shop-wall', 0, 0, 0, 160, 128);
    if (!texture.has('shop-lintel')) texture.add('shop-lintel', 0, 0, 0, 160, 85);
    this.wall.setTexture(textureKey, 'shop-wall');
    this.lintel.setTexture(textureKey, 'shop-lintel');
  }

  /** Return the current visual phase for the entrance controller and browser tests. */
  get doorPhase(): ShopDoorPhase {
    return this.phase;
  }

  /**
   * Open once using three native-pixel widths, then call the caller's continuation exactly once.
   * Returns false for repeated requests. No player state or scene transition occurs here.
   */
  openDoor(onOpen: () => void): boolean {
    if (this.phase !== 'closed') return false;
    this.phase = 'opening';
    this.door.setData('phase', this.phase);
    this.drawDoor(14);
    this.scene.time.delayedCall(50, () => this.drawDoor(5));
    this.scene.time.delayedCall(100, () => {
      this.phase = 'open';
      this.drawDoor(3);
      onOpen();
    });
    return true;
  }

  /** Draw native timber boards, stone plinth, and three step treads beneath the facade. */
  private drawPorch(): void {
    const { porch, steps } = this.front;
    const trim = this.scene.add.graphics().setDepth(-6.5).setName('shop-porch-foundation');
    trim.fillStyle(0x302c2b, 0.5).fillRect(porch.x - 2, porch.y + 22, porch.width + 4, 5);
    trim.fillStyle(0x514c49).fillRect(porch.x, porch.y + 15, porch.width, 9);
    // Staggered small blocks describe the vertical face; the deck above remains a flat plane.
    for (let row = 0; row < 2; row++) {
      for (let x = porch.x + (row === 0 ? 0 : 8); x < porch.x + porch.width; x += 16) {
        trim.fillStyle(row === 0 ? 0x8c8476 : 0x716b61)
          .fillRect(x + 1, porch.y + 16 + row * 4, Math.min(14, porch.x + porch.width - x - 1), 3);
      }
    }
    this.scene.add.tileSprite(porch.x, porch.y, porch.width, porch.height, TextureKey.ShopFacade, 'shop-planks')
      .setOrigin(0, 0).setDepth(-6.4).setName('shop-walkable-deck');
    trim.fillStyle(0x4f3234).fillRect(porch.x, porch.y, porch.width, 2);
    // The central steps cross the stone face; the rest of that face is not an entrance.
    const stairs = this.scene.add.graphics().setDepth(-6.3).setName('shop-front-steps');
    for (let step = 0; step < 3; step++) {
      const x = steps.x - step * 2;
      const y = steps.y + step * 5;
      const width = steps.width + step * 4;
      stairs.fillStyle(0x573535).fillRect(x, y, width, 6);
      stairs.fillStyle(0xdba069).fillRect(x + 1, y, width - 2, 3);
      stairs.fillStyle(0xf0bd82).fillRect(x + 1, y, width - 2, 1);
      stairs.fillStyle(0xa6704e).fillRect(x + 1, y + 3, width - 2, 2);
    }
  }

  /** Redraw the oak door at a whole-pixel hinge width; never stretch or blur its texture. */
  private drawDoor(width: number): void {
    const height = this.front.door.height;
    this.door.clear().setData('phase', this.phase).setData('leafWidth', width);
    this.door.fillStyle(0x4f3234).fillRect(0, 0, width, height);
    this.door.fillStyle(0xb97e50).fillRect(1, 1, Math.max(1, width - 2), height - 2);
    this.door.fillStyle(0xe2a56b).fillRect(1, 1, 1, height - 2);
    if (width >= 5) {
      this.door.fillStyle(0x754737).fillRect(3, 4, Math.max(1, width - 6), 14);
      this.door.fillStyle(0x926241).fillRect(3, 22, Math.max(1, width - 6), 15);
      this.door.fillStyle(0xf0c879).fillRect(width - 4, 20, 2, 2);
    }
  }
}
