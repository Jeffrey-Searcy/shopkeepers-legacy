/** Visible carried goods follow the approved player sprite; inventory remains their sole owner. */
import Phaser from 'phaser';
import { FEET_CENTER_DY } from '../config/GameConfig';
import { GameState } from '../state/GameState';
import { PLAYER_ACTION_DATA_KEY } from '../config/AssetKeys';
import { ToolSystem } from './ToolSystem';

/** Scene-local hand attachment, destroyed with its player; no gameplay or saved state lives here. */
export class HeldItemView {
  private image: Phaser.GameObjects.Image | null = null;
  /**
   * Original keeper hands (tools/keeper-art masters), in px from the sprite center plus FEET_CENTER_DY:
   * front and back hands hang at frame row ~28 beside the hips; side hands rest at the hip, just ahead of center.
   * lean is the carried broom's angle in degrees. Its handle reaches head height, so in side views it leans
   * back over the shoulder; leaning forward would cross the keeper's face.
   */
  private readonly poses = {
    down: { x: 5, y: -8, depth: 1, lean: 18 }, up: { x: -6, y: -8, depth: -1, lean: -18 },
    left: { x: -2, y: -8, depth: 1, lean: 18 }, right: { x: 2, y: -8, depth: 1, lean: -18 },
  } as const;

  /** Bind an attachment to one player without changing that player's navigation textures. */
  constructor(private readonly player: Phaser.GameObjects.Sprite) {
    player.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.image !== null) this.image.destroy();
      this.image = null;
    });
  }

  /** Reflect selection, depletion, facing, and walk bob; called even while a modal stops movement. */
  update(): void {
    const item = ToolSystem.activeItem();
    // Every action except the fishing cast (a navigation pose) already draws its tool, the broom included.
    // A toolbar change must not add a new carried object over an unfinished swing. Restore the selected
    // carried item when the actor clears its intent.
    const action: unknown = this.player.getData(PLAYER_ACTION_DATA_KEY);
    if (action !== 'cast' && action != null && this.player.anims.isPlaying) {
      if (this.image !== null) this.image.setVisible(false);
      return;
    }
    if (item !== 'stew' && item !== 'ale' && item !== 'broom') {
      if (this.image !== null) this.image.setVisible(false);
      return;
    }
    const texture = `icon-${item}`;
    const scene = this.player.scene;
    if (!scene.textures.exists(texture)) throw new Error(`HeldItemView: missing ${texture}`);
    if (this.image === null) this.image = scene.add.image(0, 0, texture).setName('player-held-item');
    const pose = this.poses[GameState.instance.player.facing];
    const feet = this.player.y + FEET_CENTER_DY;
    const hand = { x: pose.x, y: FEET_CENTER_DY + pose.y };
    const bob = this.player.anims.isPlaying && this.player.anims.currentFrame !== null
      ? this.player.anims.currentFrame.index % 2 : 0;
    this.image.setTexture(texture).setData('item', item).setVisible(this.player.visible)
      .setDisplaySize(16, item === 'broom' ? 32 : 16)
      .setPosition(Math.round(this.player.x + hand.x), Math.round(this.player.y + hand.y + bob))
      .setDepth(feet + pose.depth).setAngle(item === 'broom' ? pose.lean : 0);
  }
}
