/** Layered civic exteriors: generated architecture above a native walkable landing, physical door and foreground lintel. */
import Phaser from 'phaser';
import { townBuildingGeometry, type TownBuildingFacade } from '../config/TownBuildings';
import type { TownPlot } from './TownPlanning';
import bounds from './maps/town-building-art.json' with { type: 'json' };

/** Scene-local presentation owns animation only; MapData and SceneTransitionSystem remain the physics/travel authorities. */
export class TownBuildingFront {
  readonly geometry: ReturnType<typeof townBuildingGeometry>;
  private readonly leaf: Phaser.GameObjects.Graphics;
  private opening = false;

  /** Create source-cropped facade art and independently sorted entry pieces at native world scale. */
  constructor(private readonly scene: Phaser.Scene, readonly building: TownBuildingFacade, plot: TownPlot) {
    this.geometry = townBuildingGeometry(building, plot);
    const g = this.geometry, artId = building.artId ?? building.id, box = bounds[artId as keyof typeof bounds];
    if (!box || !scene.textures.exists(building.texture)) throw new Error(`Town building: missing art for ${building.id}`);
    const texture = scene.textures.get(building.texture), source = texture.getSourceImage();
    if (!Number.isInteger(box.x) || !Number.isInteger(box.y) || box.w <= 0 || box.h <= 0 ||
      box.x < 0 || box.y < 0 || box.x + box.w > source.width || box.y + box.h > source.height) {
      throw new Error(`Town building: invalid art crop for ${building.id}`);
    }
    if (!texture.has('civic-facade')) texture.add('civic-facade', 0, box.x, box.y, box.w, box.h);
    const facadeH = Math.round(box.h * building.width / box.w);
    scene.add.image(g.x, g.sillY, building.texture, 'civic-facade').setOrigin(0, 1)
      .setDisplaySize(building.width, facadeH).setDepth(g.sillY - 42).setName(`town-building-${building.id}`);
    if (building.id === 'guardhouse') this.drawGuardhouseCrest(g.centerX, g.sillY - 75);
    const deck = scene.add.graphics().setDepth(-6).setName(`town-landing-${building.id}`);
    deck.fillStyle(0x312b2b, 0.28).fillRect(g.porch.x - 2, g.porch.y + 18, g.porch.w + 4, 7);
    deck.fillStyle(0x61524d).fillRect(g.porch.x, g.porch.y + 12, g.porch.w, 10);
    for (let y = 0; y < 16; y += 4) {
      deck.fillStyle(y % 8 === 0 ? 0xb18054 : 0xa5754e).fillRect(g.porch.x, g.porch.y + y, g.porch.w, 4);
      deck.fillStyle(0xd5a76b).fillRect(g.porch.x, g.porch.y + y, g.porch.w, 1);
      for (let x = (y % 8) * 3; x < g.porch.w; x += 24) deck.fillStyle(0x704c39).fillRect(g.porch.x + x, g.porch.y + y + 1, 1, 3);
    }
    for (let step = 0; step < 3; step++) {
      const x = g.centerX - 16 - step * 2, y = g.sillY + 16 + step * 4, width = 32 + step * 4;
      deck.fillStyle(0x634833).fillRect(x, y, width, 5);
      deck.fillStyle(0xba8c5b).fillRect(x, y, width, 3);
      deck.fillStyle(0xe3b97d).fillRect(x, y, width, 1);
    }
    // The aperture covers a generated closed/undersized entry without moving the walkable sill.
    scene.add.rectangle(g.centerX - 12, g.sillY - 40, 24, 40, 0x241e27).setOrigin(0)
      .setDepth(g.sillY - 41).setName(`town-door-aperture-${building.id}`);
    const frame = scene.add.graphics().setDepth(g.sillY + 1).setName(`town-door-frame-${building.id}`);
    // A framed transom covers the taller source recess while keeping the physical leaf exactly24×40.
    frame.fillStyle(0x553c30).fillRect(g.centerX - 16, g.sillY - 54, 4, 54).fillRect(g.centerX + 12, g.sillY - 54, 4, 54);
    frame.fillStyle(0xba9366).fillRect(g.centerX - 15, g.sillY - 53, 2, 53).fillRect(g.centerX + 13, g.sillY - 53, 2, 53);
    frame.fillStyle(0x49322c).fillRect(g.centerX - 12, g.sillY - 52, 24, 12);
    frame.fillStyle(0xb89b66).fillRect(g.centerX - 11, g.sillY - 50, 22, 7);
    frame.fillStyle(0xdec591).fillRect(g.centerX - 10, g.sillY - 49, 20, 2);
    frame.fillStyle(0x73533c).fillRect(g.centerX - 1, g.sillY - 50, 2, 8).fillRect(g.centerX - 12, g.sillY - 42, 24, 2);
    frame.fillStyle(0x654631).fillRect(g.centerX - 18, g.sillY - 55, 36, 4);
    frame.fillStyle(0xd3ad77).fillRect(g.centerX - 18, g.sillY - 55, 36, 1);
    frame.fillStyle(0x906b48).fillRect(g.centerX - 18, g.sillY - 53, 36, 1);
    this.leaf = scene.add.graphics({ x: g.centerX - 12, y: g.sillY - 40 })
      .setDepth(g.sillY + 0.5).setName(`town-door-leaf-${building.id}`);
    this.drawDoor(24);
  }

  /** Add a small shield and lantern pair so the watch house reads as its own public service. */
  private drawGuardhouseCrest(x: number, y: number): void {
    const crest = this.scene.add.graphics().setDepth(this.geometry.sillY + 0.25).setName('town-guardhouse-crest');
    crest.fillStyle(0x352c32).fillRoundedRect(x - 15, y - 12, 30, 24, 4);
    crest.lineStyle(2, 0xd2aa68).strokeRoundedRect(x - 15, y - 12, 30, 24, 4);
    crest.fillStyle(0x8f3f43).fillTriangle(x, y + 9, x - 9, y - 5, x + 9, y - 5);
    crest.lineStyle(2, 0xf0d38f).strokeTriangle(x, y + 9, x - 9, y - 5, x + 9, y - 5);
    crest.fillStyle(0xffcf70).fillCircle(x - 20, y + 5, 3).fillCircle(x + 20, y + 5, 3);
  }

  /** Open exactly once in 100ms; scene shutdown owns timers and destroys all visual state. */
  openDoor(onOpen: () => void): void {
    if (this.opening) throw new Error(`Town building: duplicate door animation ${this.building.id}`);
    this.opening = true; this.leaf.setData('phase', 'opening'); this.drawDoor(16);
    this.scene.time.delayedCall(50, () => this.drawDoor(7));
    this.scene.time.delayedCall(100, () => { this.drawDoor(3); this.leaf.setData('phase', 'open'); onOpen(); });
  }

  /** Draw an upright oak leaf at discrete native widths; no texture stretching or motion blur. */
  private drawDoor(width: number): void {
    this.leaf.clear().setData('leafWidth', width);
    this.leaf.fillStyle(0x4b322b).fillRect(0, 0, width, 40);
    this.leaf.fillStyle(this.building.accent).fillRect(1, 1, width - 2, 38);
    this.leaf.fillStyle(0xe0b57c).fillRect(1, 1, 1, 38);
    if (width >= 7) {
      this.leaf.fillStyle(0x543c32).fillRect(3, 4, width - 6, 12).fillRect(3, 22, width - 6, 13);
      if (width >= 16) {
        this.leaf.fillStyle(0x8c6647).fillRect(4, 5, width - 8, 10).fillRect(4, 23, width - 8, 11);
        this.leaf.fillStyle(0xb48a58).fillRect(4, 5, width - 8, 1).fillRect(4, 23, width - 8, 1);
        this.leaf.fillStyle(0x684734).fillRect(width - 5, 6, 1, 9).fillRect(width - 5, 24, 1, 10);
        for (let x = 8; x < width - 5; x += 5) {
          this.leaf.fillStyle(0x795239).fillRect(x, 7, 1, 7).fillRect(x, 25, 1, 8);
        }
        this.leaf.fillStyle(0xc49962).fillRect(3, 18, width - 6, 1).fillRect(3, 37, width - 6, 1);
        this.leaf.fillStyle(0x42352e).fillRect(1, 8, 3, 2).fillRect(1, 30, 3, 2);
      }
      this.leaf.fillStyle(0x543c32).fillRect(width - 5, 18, 3, 4);
      this.leaf.fillStyle(0xefc36b).fillRect(width - 4, 19, 2, 2);
    }
  }
}
