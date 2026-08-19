/**
 * MainMenuScene — cozy title screen and three-card save-file manager.
 *
 * Cards are data-driven from SaveSystem and support both pointer and keyboard input. Empty slots
 * start fresh adventures, valid slots continue, and corrupt/occupied slots can only be deleted
 * through an explicit confirmation. All world entry routes through SceneTransitionSystem.
 */
import Phaser from 'phaser';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { dayOfSeason } from '../config/Crops';
import { GameState } from '../state/GameState';
import { SaveSystem, type SaveSlot, type SaveSlotInfo } from '../systems/SaveSystem';
import { enterWorldFromMenu } from '../systems/SceneTransitionSystem';

const CARD_W = 258;
const CARD_H = 218;
const CARD_Y = 306;
const CARD_X = [205, 480, 755] as const;

/** Human-friendly world label for save-card metadata. */
function locationLabel(scene: string): string {
  const labels: Record<string, string> = {
    FarmScene: 'The Farm',
    TownScene: 'Willowbrook',
    HomeInteriorScene: 'Tavern Upstairs',
    ForestScene: 'Whispering Woods',
    BeachScene: 'Sunpetal Beach',
    MountainScene: 'Mountain Pass',
    MinesScene: 'Old Mines',
  };
  return labels[scene] ?? scene;
}

/** Format a timestamp compactly without hiding invalid metadata behind a fallback. */
function savedLabel(savedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAt));
}

export class MainMenuScene extends Phaser.Scene {
  private selectedIndex = 0;
  private cardsRoot!: Phaser.GameObjects.Container;
  private confirmRoot!: Phaser.GameObjects.Container;
  /** New-slot-only inheritance story; never shown while continuing a ready save. */
  private originRoot!: Phaser.GameObjects.Container;
  /** Choice-page content is separate so tests and pointer ownership can inspect it directly. */
  private originChoiceRoot!: Phaser.GameObjects.Container;
  private originSlot: SaveSlot | null = null;
  private originPage: 0 | 1 | 2 = 0;
  private confirmSlot: SaveSlot | null = null;
  private confirmChoice: 0 | 1 = 0;
  private statusText!: Phaser.GameObjects.Text;
  private confirmTabText!: Phaser.GameObjects.Text;
  /** De-duplicate one native key event without throttling intentional fast navigation. */
  private keyboardEvents = new WeakSet<KeyboardEvent>();

  constructor() {
    super(SceneKey.MainMenu);
  }

  create(): void {
    SaveSystem.endSession();
    this.input.topOnly = true;
    this.drawBackdrop();
    this.add
      .text(480, 58, "Shopkeeper's Legacy", {
        fontFamily: 'Georgia, serif',
        fontSize: '44px',
        color: '#fff2c7',
        stroke: '#3d251d',
        strokeThickness: 7,
        shadow: { offsetX: 0, offsetY: 4, color: '#173733', blur: 0, fill: true },
      })
      .setOrigin(0.5);
    this.add
      .text(480, 111, 'A little life, one day at a time', {
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: '18px',
        color: '#d8dfb7',
      })
      .setOrigin(0.5);

    this.add
      .text(480, 158, 'Choose an Adventure', {
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '18px',
        color: '#f5d98c',
        letterSpacing: 2,
      })
      .setOrigin(0.5);
    this.cardsRoot = this.add.container(0, 0);
    this.statusText = this.add
      .text(480, 467, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd78d' })
      .setOrigin(0.5);
    this.add
      .text(480, 507, '← → choose  •  Enter play  •  Delete remove  •  mouse supported', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#afc6a7',
      })
      .setOrigin(0.5);

    this.confirmRoot = this.buildConfirmOverlay();
    this.originRoot = this.add.container(0, 0).setName('origin-intro-root').setDepth(110).setVisible(false);
    this.originChoiceRoot = this.add.container(0, 0).setName('origin-choice-root').setDepth(111).setVisible(false);
    this.refreshCards();
    this.bindKeyboard();
  }

  /** Layered dusk garden and tiny shop silhouette, drawn without introducing a new art dependency. */
  private drawBackdrop(): void {
    this.add.rectangle(0, 0, 960, 540, 0x173b40).setOrigin(0, 0);
    this.add.rectangle(0, 118, 960, 422, 0x285b4b).setOrigin(0, 0);
    // A clipped crescent and drifting meadow lights make the menu feel like a living evening,
    // while staying deliberately simpler than the pixel-art gameplay scene it introduces.
    this.add.circle(112, 68, 25, 0xffe6a5, 0.12);
    this.add.circle(112, 68, 15, 0xffe6a5, 0.95);
    this.add.circle(120, 63, 15, 0x173b40, 1);
    const hills = this.add.graphics();
    hills.fillStyle(0x326b50, 1).fillEllipse(160, 238, 470, 215);
    hills.fillStyle(0x214c42, 1).fillEllipse(785, 242, 610, 230);
    hills.fillStyle(0x183c36, 1).fillRect(0, 420, 960, 120);
    for (const [x, y] of [[89, 55], [157, 84], [766, 56], [843, 90], [700, 114]] as const) {
      this.add.rectangle(x, y, 3, 3, 0xffe59a).setAngle(45);
    }
    for (const [index, x, y] of [[0, 136, 185], [1, 670, 207], [2, 886, 245]] as const) {
      const light = this.add.circle(x, y, 3, 0xffdc72, 0.72);
      this.tweens.add({
        targets: light,
        y: y - 5,
        alpha: 0.25,
        duration: 1100 + index * 180,
        delay: index * 170,
        yoyo: true,
        repeat: -1,
      });
    }
    // A tiny warmly-lit shop on the horizon gives the title a place-specific storybook mark.
    const shop = this.add.graphics();
    shop.fillStyle(0x4a2d28).fillTriangle(735, 151, 852, 151, 794, 105);
    shop.fillStyle(0x8b5b3e).fillRect(748, 151, 92, 74);
    shop.fillStyle(0x2b4538).fillRect(785, 181, 20, 44);
    shop.fillStyle(0xffd47f).fillRect(760, 168, 17, 17).fillRect(813, 168, 17, 17);
    shop.lineStyle(3, 0x3a2823).strokeRect(748, 151, 92, 74);
    const leaves = this.add.graphics();
    for (const x of [34, 64, 904, 933]) {
      leaves.fillStyle(0x4f8659, 1).fillCircle(x, 430, 28);
      leaves.fillStyle(0x376b4b, 1).fillCircle(x + 10, 409, 22);
    }
  }

  /** Rebuild the three cards from authoritative SaveSystem inspection. */
  private refreshCards(): void {
    this.cardsRoot.removeAll(true);
    const slots = SaveSystem.listSlots();
    for (let index = 0; index < slots.length; index++) {
      this.cardsRoot.add(this.buildCard(slots[index], index));
    }
    this.statusText.setText('');
  }

  /** Build one selected/unselected empty, ready, or corrupt slot card. */
  private buildCard(info: SaveSlotInfo, index: number): Phaser.GameObjects.Container {
    const selected = index === this.selectedIndex;
    const x = CARD_X[index];
    // The selected garden ledger lifts from the row like a book being chosen from a shelf.
    const root = this.add.container(x, CARD_Y + (selected ? -7 : 0)).setName(`save-slot-${info.slot}`);
    const shadow = this.add.rectangle(5, 7, CARD_W, CARD_H, 0x102b28, 0.58).setOrigin(0.5);
    const frame = this.add
      .rectangle(0, 0, CARD_W, CARD_H, selected ? 0x6f422c : 0x543426, 1)
      .setStrokeStyle(selected ? 5 : 3, selected ? 0xffd46f : 0x9e774d, 1)
      .setOrigin(0.5);
    const paper = this.add.rectangle(0, 1, CARD_W - 18, CARD_H - 18, selected ? 0xf7e5b6 : 0xe8d2a2, 1);
    const tab = this.add
      .rectangle(0, -CARD_H / 2, 92, 27, selected ? 0x6f422c : 0x543426)
      .setStrokeStyle(selected ? 3 : 2, selected ? 0xffd46f : 0x9e774d);
    root.add([shadow, frame, paper, tab]);

    if (selected) {
      root.add(this.add.text(-CARD_W / 2 + 13, -CARD_H / 2 + 10, '❧', { fontSize: '23px', color: '#467b4d' }));
    }
    root.add(
      this.add
        .text(0, -CARD_H / 2, `SAVE ${info.slot}`, {
          fontFamily: 'monospace',
          fontStyle: 'bold',
          fontSize: '14px',
          color: selected ? '#fff0bd' : '#b88758',
        })
        .setOrigin(0.5)
    );

    if (info.status === 'empty') {
      root.add(this.add.text(0, -31, '+', { fontFamily: 'Georgia, serif', fontSize: '44px', color: '#4e8050' }).setOrigin(0.5));
      root.add(this.add.text(0, 15, 'New Adventure', { fontFamily: 'Georgia, serif', fontSize: '21px', color: '#3c3429' }).setOrigin(0.5));
      root.add(this.add.text(0, 45, 'A fresh patch of earth\nawaits.', { align: 'center', fontFamily: 'monospace', fontSize: '12px', color: '#78654d' }).setOrigin(0.5));
      root.add(this.actionPill('BEGIN', 74, 0x4f7d50));
    } else if (info.status === 'ready') {
      const season = info.season.toUpperCase();
      root.add(this.add.text(0, -44, `${season}  ${dayOfSeason(info.day)}`, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '19px', color: '#3f5636' }).setOrigin(0.5));
      root.add(this.add.text(0, -12, `Day ${info.day}  •  ${info.gold.toLocaleString()}g`, { fontFamily: 'monospace', fontSize: '14px', color: '#5b4734' }).setOrigin(0.5));
      root.add(this.add.text(0, 17, locationLabel(info.activeScene), { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#4b382b' }).setOrigin(0.5));
      root.add(this.add.text(0, 43, savedLabel(info.savedAt), { fontFamily: 'monospace', fontSize: '10px', color: '#89755c' }).setOrigin(0.5));
      root.add(this.actionPill('CONTINUE', 74, 0x4f7d50));
      const remove = this.add
        .text(105, -88, '×', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '20px', color: '#9d4e3d' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      remove.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.openDelete(info.slot);
      });
      root.add(remove);
    } else {
      root.add(this.add.text(0, -35, '!', { fontFamily: 'Georgia, serif', fontSize: '39px', color: '#a24f3b' }).setOrigin(0.5));
      root.add(this.add.text(0, 5, 'Damaged Save', { fontFamily: 'Georgia, serif', fontSize: '20px', color: '#74382f' }).setOrigin(0.5));
      root.add(this.add.text(0, 38, 'This file cannot be loaded safely.', { fontFamily: 'monospace', fontSize: '10px', color: '#786054' }).setOrigin(0.5));
      root.add(this.actionPill('DELETE TO REUSE', 74, 0x9b5943));
    }

    frame.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.selectedIndex = index;
      this.refreshCards();
      this.activateSelected();
    });
    return root;
  }

  /** Create a small high-contrast primary-action label within a card. */
  private actionPill(label: string, y: number, color: number): Phaser.GameObjects.Container {
    const pill = this.add.container(0, y);
    pill.add(this.add.rectangle(0, 0, 136, 29, color).setStrokeStyle(2, 0x315337));
    pill.add(this.add.text(0, 0, label, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff4d0' }).setOrigin(0.5));
    return pill;
  }

  /** Start or load the currently selected slot. Corrupt slots route to delete confirmation. */
  private activateSelected(): void {
    const info = SaveSystem.listSlots()[this.selectedIndex];
    try {
      if (info.status === 'empty') {
        this.openOriginIntro(info.slot);
      } else if (info.status === 'ready') {
        SaveSystem.load(info.slot);
        const gs = GameState.instance;
        enterWorldFromMenu(this, gs.activeScene, { ...gs.player });
      } else {
        this.openDelete(info.slot);
      }
    } catch (error) {
      this.refreshCards();
      this.statusText.setText(error instanceof Error ? error.message : String(error));
    }
  }

  /** Open the inheritance story for an explicitly empty slot without binding or writing it yet. */
  private openOriginIntro(slot: SaveSlot): void {
    const info = SaveSystem.inspectSlot(slot);
    if (info.status !== 'empty') {
      throw new Error(`MainMenuScene: Save ${slot} is no longer empty`);
    }
    this.originSlot = slot;
    this.originPage = 0;
    this.originRoot.setVisible(true);
    this.renderOriginPage();
  }

  /** Close the intro without creating a session or mutating the selected save slot. */
  private closeOriginIntro(): void {
    this.originSlot = null;
    this.originPage = 0;
    this.originRoot.setVisible(false);
    this.originChoiceRoot.setVisible(false);
    this.originRoot.removeAll(true);
    this.originChoiceRoot.removeAll(true);
  }

  /** Advance letter -> departure -> choice, then confirm the only enabled Tavern path. */
  private advanceOriginIntro(): void {
    if (this.originSlot === null) return;
    if (this.originPage < 2) {
      this.originPage = (this.originPage + 1) as 1 | 2;
      this.renderOriginPage();
      return;
    }
    this.confirmTavernOrigin();
  }

  /** Bind the chosen empty slot and enter the existing named Farm start through official systems. */
  private confirmTavernOrigin(): void {
    const slot = this.originSlot;
    if (slot === null) return;
    try {
      if (SaveSystem.inspectSlot(slot).status !== 'empty') {
        throw new Error(`MainMenuScene: Save ${slot} is no longer empty`);
      }
      this.closeOriginIntro();
      SaveSystem.beginNewGame(slot);
      enterWorldFromMenu(this, SceneKey.Farm, null);
    } catch (error) {
      this.closeOriginIntro();
      this.refreshCards();
      this.statusText.setText(error instanceof Error ? error.message : String(error));
    }
  }

  /** Rebuild one of the three bounded origin pages. */
  private renderOriginPage(): void {
    this.originRoot.removeAll(true);
    this.originChoiceRoot.removeAll(true);
    this.originChoiceRoot.setVisible(false);

    const scrim = this.add.rectangle(0, 0, 960, 540, 0x102827, 0.97).setOrigin(0, 0).setInteractive();
    this.originRoot.add(scrim);
    this.drawOriginBackdrop();

    if (this.originPage === 0) this.drawGrandpaLetter();
    else if (this.originPage === 1) this.drawDeparturePage();
    else this.drawBusinessChoice();
  }

  /** Draw the shared pressed-flower scrapbook frame and brass-key continuity motif. */
  private drawOriginBackdrop(): void {
    const frame = this.add.graphics();
    frame.fillStyle(0x284d43, 1).fillRoundedRect(31, 26, 898, 488, 18);
    frame.lineStyle(4, 0xc49a58, 1).strokeRoundedRect(31, 26, 898, 488, 18);
    frame.lineStyle(2, 0x6f4a32, 1).strokeRoundedRect(40, 35, 880, 470, 14);
    this.originRoot.add(frame);
    for (const [x, y, angle] of [[61, 64, -18], [887, 62, 24], [69, 472, 18], [892, 469, -22]] as const) {
      const sprig = this.add.graphics().setPosition(x, y).setAngle(angle);
      sprig.lineStyle(3, 0x78955a, 1).lineBetween(0, -18, 0, 18);
      sprig.fillStyle(0xaac071, 1).fillEllipse(-6, -8, 11, 6).fillEllipse(6, 2, 11, 6);
      sprig.fillStyle(0xe0b461, 1).fillCircle(-1, -18, 3);
      this.originRoot.add(sprig);
    }
    this.originRoot.add(
      this.add
        .text(73, 48, `THE WILLOWBROOK PAPERS  •  SAVE ${this.originSlot ?? ''}`, {
          fontFamily: 'monospace',
          fontStyle: 'bold',
          fontSize: '11px',
          color: '#d7bd7a',
          letterSpacing: 1,
        })
    );
    this.originRoot.add(
      this.add
        .text(883, 49, `${this.originPage + 1} / 3`, {
          fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: '#d7bd7a'
        })
        .setOrigin(1, 0)
    );
  }

  /** First story beat: the letter that passes the shop and its brass key to the player. */
  private drawGrandpaLetter(): void {
    const shadow = this.add.rectangle(488, 278, 654, 362, 0x0b201f, 0.62).setAngle(1.3);
    const paper = this.add.rectangle(480, 267, 654, 362, 0xf1dfb5).setStrokeStyle(4, 0x8b603d).setAngle(-0.8);
    this.originRoot.add([shadow, paper]);
    this.originRoot.add(
      this.add.text(480, 111, 'A Letter Kept Too Long', {
        fontFamily: 'Georgia, serif',
        fontSize: '29px',
        color: '#553727',
      }).setOrigin(0.5)
    );
    this.originRoot.add(
      this.add.text(
        480,
        249,
        "My dear grandchild,\n\nIf the city has made your days feel borrowed,\ncome home to Willowbrook. The old shop is yours now.\nIt needs steady hands, a warm hearth—and someone\nbrave enough to hang a new sign above the door.\n\nI left the brass key where our story always began.\n\n— Grandpa",
        { fontFamily: 'Georgia, serif', fontSize: '17px', color: '#4d3829', align: 'center', lineSpacing: 6 }
      ).setOrigin(0.5)
    );
    // Faint letterpress rules and Grandpa's pressed clover keep the safest composition personal.
    const letterpress = this.add.graphics();
    letterpress.lineStyle(1, 0xb99768, 0.28);
    for (const y of [154, 182, 210, 238, 266, 294, 322, 350]) {
      letterpress.lineBetween(211, y, 741, y);
    }
    letterpress.fillStyle(0x6f8b4d, 0.78)
      .fillEllipse(641, 366, 12, 7)
      .fillEllipse(653, 366, 12, 7)
      .fillEllipse(647, 358, 8, 12);
    letterpress.lineStyle(2, 0x59733f, 0.8).lineBetween(647, 370, 657, 388);
    this.originRoot.add(letterpress);
    const postcard = this.add.container(279, 389).setAngle(-2.5);
    postcard.add(this.add.rectangle(0, 0, 112, 70, 0xe4c98f).setStrokeStyle(2, 0x8d6742));
    const oldShop = this.add.graphics();
    oldShop.lineStyle(3, 0x775337, 0.8)
      .strokeRect(-36, -8, 72, 30)
      .strokeTriangle(-42, -8, 42, -8, 0, -31)
      .strokeRect(-8, 4, 16, 18);
    oldShop.lineStyle(2, 0x775337, 0.8).lineBetween(-42, 8, -55, 8).strokeRect(-55, 8, 12, 10);
    postcard.add(oldShop);
    postcard.add(this.add.text(0, 29, "GRANDPA'S FIRST SIGN", { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '6px', color: '#62452f' }).setOrigin(0.5));
    this.originRoot.add(postcard);
    const seal = this.add.circle(744, 391, 25, 0x9c4635).setStrokeStyle(3, 0x6f2f29);
    this.originRoot.add(seal);
    this.originRoot.add(this.add.text(744, 391, 'S', { fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: '20px', color: '#e2bb74' }).setOrigin(0.5));
    this.drawBrassKey(207, 389, this.originRoot);
    this.originRoot.add(this.originContinueButton('TURN THE PAGE'));
  }

  /** Second story beat: leave the gray office behind and follow the road home. */
  private drawDeparturePage(): void {
    const panel = this.add.graphics();
    panel.fillStyle(0x24363d, 1).fillRoundedRect(95, 96, 350, 326, 10);
    panel.fillStyle(0x4d5b61, 1).fillRect(124, 126, 292, 150);
    panel.lineStyle(8, 0x2d2928, 1).strokeRect(124, 126, 292, 150);
    panel.lineStyle(5, 0x2d2928, 1).lineBetween(270, 126, 270, 276).lineBetween(124, 201, 416, 201);
    for (let i = 0; i < 9; i++) {
      const x = 145 + ((i * 37) % 248);
      const y = 143 + ((i * 53) % 111);
      panel.lineStyle(2, 0x8aa7ab, 0.65).lineBetween(x, y, x - 8, y + 16);
    }
    panel.fillStyle(0x5b3b2d, 1).fillRect(119, 323, 302, 67);
    panel.fillStyle(0xe4d1a7, 1).fillRect(290, 334, 77, 45);
    // The player's last silhouette, coffee, and packed satchel turn the office block into a story
    // beat rather than an abstract window card.
    panel.fillStyle(0x241d20, 1).fillCircle(207, 300, 14).fillRoundedRect(187, 310, 41, 52, 8);
    panel.fillStyle(0xc58b53, 1).fillRect(154, 338, 27, 18);
    panel.lineStyle(3, 0x8b5a3b, 1).strokeRect(154, 338, 27, 18);
    panel.lineStyle(3, 0xe3d3b1, 1).strokeCircle(389, 344, 7).lineBetween(396, 344, 403, 344);
    this.originRoot.add(panel);
    this.drawBrassKey(328, 357, this.originRoot);

    this.originRoot.add(
      this.add.text(633, 135, 'One last shift.', {
        fontFamily: 'Georgia, serif', fontSize: '31px', color: '#f5dfad'
      }).setOrigin(0.5)
    );
    this.originRoot.add(
      this.add.text(
        633,
        254,
        'The resignation fit in one envelope.\nThe key fit in one pocket.\n\nBy sunrise, the train was winding past fields\nyou had only known from Grandpa’s stories.',
        { fontFamily: 'Georgia, serif', fontSize: '17px', color: '#d9d5bc', align: 'center', lineSpacing: 8 }
      ).setOrigin(0.5)
    );
    this.originRoot.add(
      this.add.text(633, 365, '“Build a place people are glad to return to.”', {
        fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '16px', color: '#e2b963'
      }).setOrigin(0.5)
    );
    const ticket = this.add.container(633, 415).setAngle(-2);
    ticket.add(this.add.rectangle(0, 0, 214, 34, 0xdfc98f).setStrokeStyle(2, 0x8b6840));
    ticket.add(this.add.text(0, 0, 'WILLOWBROOK  •  ONE WAY', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '10px', color: '#60452e' }).setOrigin(0.5));
    this.originRoot.add(ticket);
    this.originRoot.add(this.originContinueButton('FOLLOW THE ROAD'));
  }

  /** Final story beat: show the enabled Tavern identity and the honest future Item Shop option. */
  private drawBusinessChoice(): void {
    this.originChoiceRoot.setVisible(true);
    this.originChoiceRoot.add(
      this.add.text(480, 82, 'What will the old shop become?', {
        fontFamily: 'Georgia, serif', fontSize: '30px', color: '#f7e3ad'
      }).setOrigin(0.5)
    );
    this.originChoiceRoot.add(
      this.add.text(480, 116, 'Your first sign can change the whole valley.', {
        fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '15px', color: '#c9d4ae'
      }).setOrigin(0.5)
    );

    const tavern = this.add.container(314, 306).setName('origin-tavern-card');
    const tavernShadow = this.add.rectangle(5, 7, 300, 310, 0x071d1b, 0.62);
    const tavernFrame = this.add.rectangle(0, 0, 300, 310, 0x6a422d).setStrokeStyle(5, 0xf1c464).setInteractive({ useHandCursor: true });
    const tavernPaper = this.add.rectangle(0, 0, 280, 290, 0xead6a6);
    const artHalo = this.add.ellipse(0, -57, 192, 148, 0x6e9a63, 0.32);
    const art = this.add.image(0, -62, TextureKey.TavernExterior).setScale(0.88);
    tavern.add([tavernShadow, tavernFrame, tavernPaper, artHalo, art]);
    tavern.add(this.add.text(0, 31, 'TAVERN & INN', { fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: '23px', color: '#553527' }).setOrigin(0.5));
    tavern.add(this.add.text(0, 65, 'Warm meals  •  Guest rooms\nA lively home for travelers', { fontFamily: 'monospace', fontSize: '11px', color: '#66533d', align: 'center', lineSpacing: 4 }).setOrigin(0.5));
    tavern.add(this.add.rectangle(0, 119, 180, 38, 0x4f7d50).setStrokeStyle(3, 0x315337));
    tavern.add(this.add.text(0, 119, 'HANG THIS SIGN', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff1c5' }).setOrigin(0.5));
    tavernFrame.on('pointerdown', () => this.confirmTavernOrigin());
    this.originChoiceRoot.add(tavern);

    const itemShop = this.add.container(646, 306).setName('origin-item-shop-card').setAlpha(0.82);
    itemShop.add(this.add.rectangle(5, 7, 300, 310, 0x071d1b, 0.5));
    itemShop.add(this.add.rectangle(0, 0, 300, 310, 0x46545a).setStrokeStyle(3, 0xa7b1a8));
    itemShop.add(this.add.rectangle(0, 0, 280, 290, 0xd2d0b7));
    itemShop.add(this.add.rectangle(0, -133, 188, 25, 0x58717a).setStrokeStyle(2, 0x344c54));
    itemShop.add(this.add.text(0, -133, 'FUTURE BUSINESS PATH', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '10px', color: '#e6e3cd' }).setOrigin(0.5));
    const shopSketch = this.add.graphics();
    shopSketch.lineStyle(4, 0x586d70, 1).strokeRect(-72, -87, 144, 105);
    shopSketch.lineStyle(4, 0x586d70, 1).strokeTriangle(-88, -87, 88, -87, 0, -139);
    shopSketch.lineStyle(3, 0x839392, 1).strokeRect(-53, -59, 32, 34).strokeRect(21, -59, 32, 34).strokeRect(-13, -31, 26, 49);
    shopSketch.lineStyle(2, 0x9ba083, 0.8).lineBetween(-93, -114, 91, 7).lineBetween(91, -114, -91, 7);
    itemShop.add(shopSketch);
    itemShop.add(this.add.text(0, 31, 'ITEM SHOP', { fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: '23px', color: '#4c4941' }).setOrigin(0.5));
    itemShop.add(this.add.text(0, 65, 'Curios  •  Crafted goods\nA future way to do business', { fontFamily: 'monospace', fontSize: '11px', color: '#5d5a51', align: 'center', lineSpacing: 4 }).setOrigin(0.5));
    itemShop.add(this.add.rectangle(0, 119, 180, 38, 0x58717a).setStrokeStyle(2, 0x344c54));
    itemShop.add(this.add.text(0, 119, 'COMING SOON', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#f1efd9' }).setOrigin(0.5));
    this.originChoiceRoot.add(itemShop);

    this.drawBrassKey(474, 438, this.originChoiceRoot);
    this.originChoiceRoot.add(this.add.rectangle(480, 476, 270, 26, 0x173b35, 0.92).setStrokeStyle(1, 0x78916a));
    this.originChoiceRoot.add(
      this.add.text(480, 476, 'Enter Tavern  •  Esc back', {
        fontFamily: 'monospace', fontStyle: 'bold', fontSize: '14px', color: '#edf0ca'
      }).setOrigin(0.5)
    );
  }

  /** Create the shared keyboard/pointer continuation button for story pages. */
  private originContinueButton(label: string): Phaser.GameObjects.Container {
    const button = this.add.container(480, 468);
    const frame = this.add.rectangle(0, 0, 212, 40, 0x5a7f50).setStrokeStyle(3, 0xe1bb69).setInteractive({ useHandCursor: true });
    frame.on('pointerdown', () => this.advanceOriginIntro());
    button.add(frame);
    button.add(this.add.text(0, 0, label, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff0c0' }).setOrigin(0.5));
    return button;
  }

  /** Draw the same small brass key on each page to connect letter, departure, and choice. */
  private drawBrassKey(x: number, y: number, owner: Phaser.GameObjects.Container): void {
    const key = this.add.graphics().setPosition(x, y).setAngle(-12);
    key.lineStyle(7, 0xd5aa4f, 1).strokeCircle(-17, 0, 11).lineBetween(-6, 0, 31, 0);
    key.lineStyle(6, 0x8e682f, 1).lineBetween(18, 0, 18, 12).lineBetween(30, 0, 30, 9);
    key.lineStyle(2, 0xffdb75, 0.9).strokeCircle(-17, -2, 7).lineBetween(-5, -2, 29, -2);
    owner.add(key);
  }

  /** Show the destructive confirmation with Cancel selected by default. */
  private openDelete(slot: SaveSlot): void {
    this.confirmSlot = slot;
    this.confirmChoice = 0;
    this.confirmTabText.setText(`SAVE ${slot}`);
    this.confirmRoot.setVisible(true);
    this.refreshConfirm();
  }

  /** Build the modal deletion card once; labels are refreshed as selection changes. */
  private buildConfirmOverlay(): Phaser.GameObjects.Container {
    const root = this.add.container(0, 0).setDepth(100).setVisible(false);
    root.add(this.add.rectangle(0, 0, 960, 540, 0x102522, 0.78).setOrigin(0, 0).setInteractive());
    root.add(this.add.rectangle(480, 274, 470, 208, 0x5d3a2a).setStrokeStyle(5, 0xe3b966));
    root.add(this.add.rectangle(480, 274, 450, 188, 0xf1ddb0));
    root.add(this.add.rectangle(480, 170, 104, 29, 0x6f422c).setStrokeStyle(3, 0xe3b966));
    this.confirmTabText = this.add
      .text(480, 170, '', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff0bd' })
      .setOrigin(0.5);
    root.add(this.confirmTabText);
    root.add(this.add.text(480, 218, 'Remove this adventure?', { fontFamily: 'Georgia, serif', fontSize: '26px', color: '#56392d' }).setOrigin(0.5));
    root.add(this.add.text(480, 258, 'This cannot be undone.', { fontFamily: 'monospace', fontSize: '13px', color: '#8d4b3d' }).setOrigin(0.5));
    return root;
  }

  /** Redraw the two confirmation choices and their pointer handlers. */
  private refreshConfirm(): void {
    // Seven objects form the permanent modal (scrim, ledger frame/tab, title, safety warning).
    while (this.confirmRoot.length > 7) this.confirmRoot.removeAt(7, true);
    const choices = [
      { label: 'KEEP IT', x: 385, color: 0x537a50 },
      { label: 'DELETE', x: 575, color: 0x985340 },
    ] as const;
    choices.forEach((choice, index) => {
      const selected = this.confirmChoice === index;
      const button = this.add
        .rectangle(choice.x, 321, 150, 42, choice.color)
        .setStrokeStyle(selected ? 4 : 2, selected ? 0xffda77 : 0x5a382c)
        .setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => {
        this.confirmChoice = index as 0 | 1;
        this.confirmSelection();
      });
      this.confirmRoot.add(button);
      this.confirmRoot.add(this.add.text(choice.x, 321, choice.label, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '13px', color: '#fff1cc' }).setOrigin(0.5));
    });
  }

  /** Resolve the current confirmation selection. */
  private confirmSelection(): void {
    if (this.confirmChoice === 1 && this.confirmSlot !== null) SaveSystem.delete(this.confirmSlot);
    this.confirmSlot = null;
    this.confirmRoot.setVisible(false);
    this.refreshCards();
  }

  /** Bind title-screen keyboard navigation; handlers live only for this scene lifecycle. */
  private bindKeyboard(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('MainMenuScene: keyboard input unavailable');
    keyboard.addCapture(['LEFT', 'RIGHT', 'ENTER', 'ESC', 'DELETE']);
    keyboard.on('keydown-LEFT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return; // Tavern is the only enabled origin choice.
      if (this.confirmSlot !== null) {
        this.confirmChoice = 0;
        this.refreshConfirm();
      } else {
        this.selectedIndex = (this.selectedIndex + 2) % 3;
        this.refreshCards();
      }
    });
    keyboard.on('keydown-RIGHT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return; // Item Shop remains visibly disabled.
      if (this.confirmSlot !== null) {
        this.confirmChoice = 1;
        this.refreshConfirm();
      } else {
        this.selectedIndex = (this.selectedIndex + 1) % 3;
        this.refreshCards();
      }
    });
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) this.advanceOriginIntro();
      else if (this.confirmSlot !== null) this.confirmSelection();
      else this.activateSelected();
    });
    keyboard.on('keydown-DELETE', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return;
      if (this.confirmSlot !== null) return;
      const info = SaveSystem.listSlots()[this.selectedIndex];
      if (info.status !== 'empty') this.openDelete(info.slot);
    });
    keyboard.on('keydown-ESC', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) {
        this.closeOriginIntro();
        return;
      }
      if (this.confirmSlot === null) return;
      this.confirmSlot = null;
      this.confirmRoot.setVisible(false);
    });
  }

  /** Consume a physical keyboard event once while keeping distinct rapid presses responsive. */
  private consumeKeyboardEvent(event: KeyboardEvent): boolean {
    if (this.keyboardEvents.has(event)) return false;
    this.keyboardEvents.add(event);
    return true;
  }
}
