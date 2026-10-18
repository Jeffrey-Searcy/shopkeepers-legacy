/** Cozy pause journal for authored relationships and optional speech-only local character chat. */
import Phaser from 'phaser';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import type { ResidentId } from '../config/ResidentRelationships';
import { GameState } from '../state/GameState';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { expressInterestInResident, relationshipJournal, relationshipView, residentBondJournal } from '../systems/RelationshipSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { Sfx } from '../systems/SfxSystem';
import { clearResidentChatSummary, compactResidentChatNotes, deleteResidentChatExchange,
  residentChatNotes } from '../systems/ResidentChatMemorySystem';
import { townSocialEventsForBond } from '../systems/TownSocialLifeSystem';
import { socialSpotLabel } from '../systems/TownScheduleSystem';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { TextPager, type TextPageView } from './TextPager';
import { createScreenShade, uiPoint } from './UILayout';

const HEART_EMPTY = '♡';
const HEART_FULL = '♥';

/** Owns the nested journal while PauseMenu keeps the world frozen. */
export class RelationshipUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly listRoot: Phaser.GameObjects.Container;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly traitsText: Phaser.GameObjects.Text;
  private readonly bioText: Phaser.GameObjects.Text;
  private readonly heartsText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly interestButton: Phaser.GameObjects.Rectangle;
  private readonly interestLabel: Phaser.GameObjects.Text;
  private readonly chatToggle: Phaser.GameObjects.Rectangle;
  private readonly chatToggleLabel: Phaser.GameObjects.Text;
  private readonly chatInfo: Phaser.GameObjects.Text;
  private readonly portrait: Phaser.GameObjects.Sprite;
  private readonly closeButton: Phaser.GameObjects.Rectangle;
  private readonly closeLabel: Phaser.GameObjects.Text;
  private readonly chatLogRoot: Phaser.GameObjects.Container;
  private readonly chatLogTitle: Phaser.GameObjects.Text;
  private readonly chatSummaryText: Phaser.GameObjects.Text;
  private readonly chatTranscriptText: Phaser.GameObjects.Text;
  private readonly chatPageText: Phaser.GameObjects.Text;
  private readonly chatSummaryPageText: Phaser.GameObjects.Text;
  private readonly chatTranscriptPageText: Phaser.GameObjects.Text;
  private readonly chatSummaryPager: TextPager;
  private readonly chatTranscriptPager: TextPager;
  private readonly compactLabel: Phaser.GameObjects.Text;
  private readonly clearSummaryLabel: Phaser.GameObjects.Text;
  private readonly deleteExchangeLabel: Phaser.GameObjects.Text;
  private readonly connectionsRoot: Phaser.GameObjects.Container;
  private readonly connectionsListRoot: Phaser.GameObjects.Container;
  private readonly connectionsTitleText: Phaser.GameObjects.Text;
  private readonly connectionNamesText: Phaser.GameObjects.Text;
  private readonly connectionStageText: Phaser.GameObjects.Text;
  private readonly connectionProgressFill: Phaser.GameObjects.Rectangle;
  private readonly connectionLocationText: Phaser.GameObjects.Text;
  private readonly connectionContextText: Phaser.GameObjects.Text;
  private readonly connectionTranscriptText: Phaser.GameObjects.Text;
  private readonly connectionPageText: Phaser.GameObjects.Text;
  private readonly connectionTranscriptPageText: Phaser.GameObjects.Text;
  private readonly connectionTranscriptPager: TextPager;
  private selectedIndex = 0;
  private chatLogPage = 0;
  private chatLogOpen = false;
  private connectionsOpen = false;
  private selectedBondIndex = 0;
  private connectionPage = 0;
  private compacting = false;
  private pendingChatDelete: { kind: 'summary' | 'exchange'; residentId: ResidentId; exchangeIndex?: number } | null = null;
  private notice = 'The model controls words only.\nFriendship and romance still use game actions.';
  private keyboardEvents = new WeakSet<KeyboardEvent>();

  /** Build the complete fixed overlay once; open and update only refresh its data. */
  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(2_000_010).setVisible(false).setName('relationship-journal');
    this.root.add(createScreenShade(scene, COZY_THEME.shadow, 0.74).setInteractive());
    this.root.add(cozyPanel(scene, 480, 282, 908, 506, COZY_THEME.shadow, 26).setAlpha(0.36));
    this.root.add(cozyPanel(scene, 480, 273, 908, 506, COZY_THEME.leather, 26).setInteractive().setStrokeStyle(3, COZY_THEME.leatherDark));
    this.root.add(cozyPanel(scene, 266, 273, 422, 478, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border));
    this.root.add(cozyPanel(scene, 694, 273, 422, 478, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border));
    this.root.add(scene.add.rectangle(480, 273, 10, 458, COZY_THEME.leatherDark).setAlpha(0.45));
    this.root.add(scene.add.rectangle(476, 273, 2, 452, COZY_THEME.border).setAlpha(0.7));
    this.root.add(cozyPanel(scene, 266, 61, 178, 30, COZY_THEME.green, 15));
    this.root.add(scene.add.text(266, 61, 'TOWN BONDS', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '13px', color: COZY_THEME.cream }).setOrigin(0.5));
    this.root.add(scene.add.text(266, 90, 'The people who make this place home', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'italic', fontSize: '12px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    this.root.add(scene.add.text(694, 64, 'RELATIONSHIP NOTES', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    this.listRoot = scene.add.container(0, 0);
    this.root.add(this.listRoot);

    this.nameText = scene.add.text(515, 87, '', { fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '29px', color: COZY_THEME.ink }).setName('relationship-name');
    this.heartsText = scene.add.text(515, 123, '', { fontFamily: COZY_THEME.font, fontSize: '13px', color: '#b64f58' }).setName('relationship-hearts');
    this.traitsText = scene.add.text(515, 149, '', { fontFamily: COZY_THEME.font, fontStyle: 'italic', fontSize: '10px', color: COZY_THEME.muted }).setName('relationship-traits');
    this.bioText = scene.add.text(515, 174, '', { fontFamily: COZY_THEME.font, fontSize: '11px', color: COZY_THEME.ink,
      wordWrap: { width: 195, useAdvancedWrap: true }, lineSpacing: 3 }).setName('relationship-bio');
    this.statusText = scene.add.text(515, 250, '', { fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.muted,
      wordWrap: { width: 230, useAdvancedWrap: true }, lineSpacing: 2 }).setName('relationship-status');
    const portraitMat = cozyPanel(scene, 831, 211, 126, 252, COZY_THEME.mint, 40).setAlpha(0.62).setStrokeStyle(2, COZY_THEME.border);
    this.portrait = scene.add.sprite(831, 211, '__MISSING').setName('relationship-portrait');
    this.root.add([this.nameText, this.heartsText, this.traitsText, this.bioText, this.statusText, portraitMat, this.portrait]);

    this.interestButton = cozyPanel(scene, 627, 337, 224, 34, COZY_THEME.plum, 13).setInteractive({ useHandCursor: true }).setName('relationship-interest');
    this.interestLabel = scene.add.text(627, 337, 'Share your feelings', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.cream }).setOrigin(0.5);
    this.interestButton.on('pointerdown', () => this.expressInterest());
    this.chatToggle = cozyPanel(scene, 816, 337, 126, 34, COZY_THEME.pocket, 13).setInteractive({ useHandCursor: true }).setName('relationship-local-chat');
    this.chatToggleLabel = scene.add.text(816, 337, '', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5);
    this.chatToggle.on('pointerdown', () => this.toggleChat());
    this.root.add([this.interestButton, this.interestLabel, this.chatToggle, this.chatToggleLabel]);

    const connectionsButton = cozyPanel(scene, 684, 380, 168, 25, COZY_THEME.plum, 9)
      .setInteractive({ useHandCursor: true }).setName('relationship-connections');
    connectionsButton.on('pointerdown', () => this.openConnections());
    const chatLogButton = cozyPanel(scene, 831, 380, 104, 25, COZY_THEME.green, 9)
      .setInteractive({ useHandCursor: true }).setName('relationship-chat-log');
    chatLogButton.on('pointerdown', () => this.openChatLog());
    this.root.add([connectionsButton, scene.add.text(684, 380, 'TOWN RELATIONSHIPS', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.cream,
    }).setOrigin(0.5), chatLogButton, scene.add.text(831, 380, 'CHAT NOTES', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.cream,
    }).setOrigin(0.5)]);
    this.root.add(cozyPanel(scene, 694, 441, 378, 98, COZY_THEME.pocket, 14).setStrokeStyle(1, COZY_THEME.border));
    this.root.add(scene.add.text(522, 400, 'LOCAL VOICE', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted }));
    this.chatInfo = scene.add.text(522, 418, '', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
      wordWrap: { width: 344, useAdvancedWrap: true }, lineSpacing: 2 }).setName('relationship-chat-info');
    this.root.add(this.chatInfo);
    this.closeButton = cozyPanel(scene, 887, 53, 54, 27, COZY_THEME.peach, 11)
      .setInteractive({ useHandCursor: true }).setName('relationship-close');
    this.closeButton.on('pointerdown', () => this.close());
    this.closeLabel = scene.add.text(887, 53, 'Close', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink })
      .setOrigin(0.5).setName('relationship-close-label');
    this.root.add([this.closeButton, this.closeLabel]);
    this.root.add(scene.add.text(694, 501, '↑ ↓ person   •   Alt+F feelings   •   Alt+C voice   •   Esc', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5));
    this.chatLogRoot = scene.add.container(0, 0).setVisible(false).setDepth(20).setName('relationship-chat-notes');
    this.chatLogRoot.add(cozyPanel(scene, 694, 273, 438, 474, COZY_THEME.paper, 17).setStrokeStyle(2, COZY_THEME.border).setInteractive());
    this.chatLogRoot.add(cozyPanel(scene, 694, 64, 190, 29, COZY_THEME.plum, 13));
    this.chatLogTitle = scene.add.text(694, 64, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.cream }).setOrigin(0.5);
    this.chatLogRoot.add(this.chatLogTitle);
    this.chatLogRoot.add(scene.add.text(512, 98, 'COMPACT MEMORY', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted }));
    const clearSummary = cozyPanel(scene, 830, 99, 94, 20, COZY_THEME.peach, 7)
      .setInteractive({ useHandCursor: true }).setName('relationship-chat-clear-summary');
    clearSummary.on('pointerdown', () => this.clearChatSummary());
    this.clearSummaryLabel = scene.add.text(830, 99, 'CLEAR MEMORY', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '8px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('relationship-chat-clear-summary-label');
    this.chatLogRoot.add([clearSummary, this.clearSummaryLabel]);
    this.chatLogRoot.add(cozyPanel(scene, 694, 151, 372, 84, COZY_THEME.pocket, 12).setStrokeStyle(1, COZY_THEME.border));
    this.chatSummaryText = scene.add.text(520, 119, '', { fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.ink,
      wordWrap: { width: 240, useAdvancedWrap: true }, lineSpacing: 2 }).setName('relationship-chat-summary');
    this.chatLogRoot.add(this.chatSummaryText);
    this.chatSummaryPager = new TextPager(this.chatSummaryText, 4);
    this.chatSummaryPageText = this.addPageControls(this.chatLogRoot, 852, 151,
      'relationship-chat-summary', delta => this.moveChatSummaryPage(delta));
    this.chatLogRoot.add(scene.add.text(512, 212, 'SAVED CONVERSATION', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted }));
    const deleteExchange = cozyPanel(scene, 830, 213, 94, 20, COZY_THEME.peach, 7)
      .setInteractive({ useHandCursor: true }).setName('relationship-chat-delete-exchange');
    deleteExchange.on('pointerdown', () => this.deleteChatExchange());
    this.deleteExchangeLabel = scene.add.text(830, 213, 'DELETE CHAT', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '8px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('relationship-chat-delete-exchange-label');
    this.chatLogRoot.add([deleteExchange, this.deleteExchangeLabel]);
    this.chatLogRoot.add(cozyPanel(scene, 694, 311, 372, 168, COZY_THEME.pocket, 12).setStrokeStyle(1, COZY_THEME.border));
    this.chatTranscriptText = scene.add.text(520, 239, '', { fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.ink,
      wordWrap: { width: 240, useAdvancedWrap: true }, lineSpacing: 3 }).setName('relationship-chat-transcript');
    this.chatLogRoot.add(this.chatTranscriptText);
    this.chatTranscriptPager = new TextPager(this.chatTranscriptText, 7);
    this.chatTranscriptPageText = this.addPageControls(this.chatLogRoot, 852, 311,
      'relationship-chat-transcript', delta => this.moveChatTranscriptPage(delta));
    const older = cozyPanel(scene, 556, 415, 74, 25, COZY_THEME.paperDark, 9).setInteractive({ useHandCursor: true }).setName('relationship-chat-older');
    older.on('pointerdown', () => this.changeChatExchange(1));
    const newer = cozyPanel(scene, 832, 415, 74, 25, COZY_THEME.paperDark, 9).setInteractive({ useHandCursor: true }).setName('relationship-chat-newer');
    newer.on('pointerdown', () => this.changeChatExchange(-1));
    this.chatPageText = scene.add.text(694, 415, '', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.muted }).setOrigin(0.5);
    this.chatLogRoot.add([older, newer,
      scene.add.text(556, 415, 'OLDER', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      scene.add.text(832, 415, 'NEWER', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      this.chatPageText]);
    const compact = cozyPanel(scene, 622, 458, 202, 32, COZY_THEME.green, 12).setInteractive({ useHandCursor: true }).setName('relationship-chat-compact');
    compact.on('pointerdown', () => void this.compactChatLog());
    this.compactLabel = scene.add.text(622, 458, 'COMPACT MEMORY', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.cream }).setOrigin(0.5);
    const profile = cozyPanel(scene, 827, 458, 104, 32, COZY_THEME.peach, 12).setInteractive({ useHandCursor: true }).setName('relationship-chat-profile');
    profile.on('pointerdown', () => this.closeChatLog());
    this.chatLogRoot.add([compact, this.compactLabel, profile,
      scene.add.text(827, 458, 'PROFILE', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      scene.add.text(694, 491, 'Wheel / ↑ ↓ pages  •  Shift+↑ ↓ memory  •  ← → saved chat', {
        fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
      }).setOrigin(0.5)]);
    this.root.add(this.chatLogRoot);

    // A second spread turns abstract timers into a readable social record without crowding profiles.
    this.connectionsRoot = scene.add.container(0, 0).setVisible(false).setDepth(30).setName('relationship-connections-page');
    this.connectionsRoot.add(cozyPanel(scene, 266, 273, 422, 478, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border).setInteractive());
    this.connectionsRoot.add(cozyPanel(scene, 694, 273, 422, 478, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border).setInteractive());
    this.connectionsRoot.add(scene.add.rectangle(480, 273, 10, 458, COZY_THEME.leatherDark).setAlpha(0.45));
    this.connectionsRoot.add(cozyPanel(scene, 266, 62, 240, 31, COZY_THEME.plum, 15));
    this.connectionsTitleText = scene.add.text(266, 62, 'TOWN RELATIONSHIPS', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.cream,
    }).setOrigin(0.5);
    this.connectionsRoot.add(this.connectionsTitleText);
    this.connectionsRoot.add(scene.add.text(266, 91, 'One person’s changing connections around town', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'italic', fontSize: '11px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    this.connectionsListRoot = scene.add.container(0, 0);
    this.connectionsRoot.add(this.connectionsListRoot);
    this.connectionsRoot.add(scene.add.text(694, 63, 'SOCIAL NOTES', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    this.connectionNamesText = scene.add.text(515, 91, '', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '23px', color: COZY_THEME.ink,
    }).setName('connection-names');
    this.connectionsRoot.add(this.connectionNamesText);
    this.connectionsRoot.add(cozyPanel(scene, 586, 137, 142, 26, COZY_THEME.green, 12));
    this.connectionStageText = scene.add.text(586, 137, '', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.cream,
    }).setOrigin(0.5).setName('connection-stage');
    this.connectionsRoot.add(this.connectionStageText);
    this.connectionsRoot.add(scene.add.rectangle(746, 137, 188, 11, COZY_THEME.paperDark).setStrokeStyle(1, COZY_THEME.border));
    this.connectionProgressFill = scene.add.rectangle(652, 137, 1, 7, COZY_THEME.peach).setOrigin(0, 0.5).setName('connection-progress');
    this.connectionsRoot.add(this.connectionProgressFill);
    this.connectionLocationText = scene.add.text(515, 160, '', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
      wordWrap: { width: 360, useAdvancedWrap: true }, lineSpacing: 2,
    }).setName('connection-location');
    this.connectionsRoot.add(this.connectionLocationText);
    this.connectionContextText = scene.add.text(515, 185, '', {
      fontFamily: COZY_THEME.font, fontStyle: 'italic', fontSize: '9px', color: '#a95a5e',
      wordWrap: { width: 360, useAdvancedWrap: true },
    }).setName('connection-context');
    this.connectionsRoot.add(this.connectionContextText);
    this.connectionsRoot.add(scene.add.text(515, 212, 'RECENT MOMENT', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted,
    }));
    this.connectionsRoot.add(cozyPanel(scene, 694, 310, 372, 166, COZY_THEME.pocket, 13).setStrokeStyle(1, COZY_THEME.border));
    this.connectionTranscriptText = scene.add.text(520, 238, '', {
      fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.ink,
      wordWrap: { width: 240, useAdvancedWrap: true }, lineSpacing: 3,
    }).setName('connection-transcript');
    this.connectionsRoot.add(this.connectionTranscriptText);
    this.connectionTranscriptPager = new TextPager(this.connectionTranscriptText, 7);
    this.connectionTranscriptPageText = this.addPageControls(this.connectionsRoot, 852, 310,
      'connection-transcript', delta => this.moveConnectionTranscriptPage(delta));
    const olderSocial = cozyPanel(scene, 556, 414, 74, 25, COZY_THEME.paperDark, 9)
      .setInteractive({ useHandCursor: true }).setName('connection-older');
    olderSocial.on('pointerdown', () => this.changeSocialEvent(1));
    const newerSocial = cozyPanel(scene, 832, 414, 74, 25, COZY_THEME.paperDark, 9)
      .setInteractive({ useHandCursor: true }).setName('connection-newer');
    newerSocial.on('pointerdown', () => this.changeSocialEvent(-1));
    this.connectionPageText = scene.add.text(694, 414, '', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('connection-page');
    this.connectionsRoot.add([olderSocial, newerSocial,
      scene.add.text(556, 414, 'OLDER', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      scene.add.text(832, 414, 'NEWER', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      this.connectionPageText]);
    const profiles = cozyPanel(scene, 694, 458, 204, 32, COZY_THEME.peach, 12)
      .setInteractive({ useHandCursor: true }).setName('connection-profiles');
    profiles.on('pointerdown', () => this.closeConnections());
    this.connectionsRoot.add([profiles, scene.add.text(694, 474, 'BACK TO PEOPLE', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink,
    }).setPosition(694, 458).setOrigin(0.5),
    scene.add.text(694, 491, 'PageUp / PageDown or wheel reads the full moment', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5)]);
    this.root.add(this.connectionsRoot);
    this.bindKeyboard();
    this.bindWheel();
  }

  /** Open from Pause without resuming the world or leaking the activation key into chat. */
  open(event?: KeyboardEvent): void {
    if (event) this.keyboardEvents.add(event);
    GameState.instance.relationshipJournalOpen = true;
    this.chatLogOpen = false;
    this.chatLogRoot.setVisible(false);
    this.pendingChatDelete = null;
    this.connectionsOpen = false;
    this.connectionsRoot.setVisible(false);
    this.closeButton.setVisible(true);
    this.closeLabel.setVisible(true);
    this.chatSummaryPager.reset();
    this.chatTranscriptPager.reset();
    this.connectionTranscriptPager.reset();
    this.notice = 'The model controls words only.\nFriendship and romance still use game actions.';
    cozyPop(this.scene, this.root);
    this.refresh();
  }

  /** Mirror visibility only; rebuilding every frame destroys pointer targets before clicks land. */
  update(): void {
    this.root.setVisible(GameState.instance.relationshipJournalOpen);
  }

  /** Return to Pause while preserving the paused world. */
  private close(): void {
    if (this.chatLogOpen) { this.closeChatLog(); return; }
    if (this.connectionsOpen) { this.closeConnections(); return; }
    GameState.instance.relationshipJournalOpen = false;
    Sfx.play('select');
  }

  /** Draw the stable resident list and the selected public record. Hidden tastes never enter this view. */
  private refresh(): void {
    const entries = relationshipJournal();
    this.selectedIndex = Phaser.Math.Clamp(this.selectedIndex, 0, entries.length - 1);
    this.listRoot.removeAll(true);
    entries.forEach((entry, index) => {
      const selected = index === this.selectedIndex, y = 121 + index * 28;
      const button = cozyPanel(this.scene, 266, y, 342, 24, selected ? COZY_THEME.green : COZY_THEME.pocket, 9)
        .setInteractive({ useHandCursor: true }).setName(`relationship-resident-${entry.id}`);
      button.on('pointerdown', () => { this.selectedIndex = index;
        this.chatLogPage = 0; this.pendingChatDelete = null; this.chatSummaryPager.reset(); this.chatTranscriptPager.reset();
        this.notice = 'Find them in town to use authored Talk or optional Chat.';
        Sfx.play('select'); this.refresh(); });
      button.on('pointerover', () => {
        if (index !== this.selectedIndex) button.setFillStyle(COZY_THEME.paperDark);
      });
      button.on('pointerout', () => {
        if (index !== this.selectedIndex) button.setFillStyle(COZY_THEME.pocket);
      });
      const marker = entry.romanceStage === 'friends' ? '' : entry.romanceStage === 'committed' ? ' ♥' : ' ♡';
      this.listRoot.add([button,
        this.scene.add.text(111, y, entry.name, { fontFamily: COZY_THEME.font, fontSize: '11px', color: selected ? COZY_THEME.cream : COZY_THEME.ink }).setOrigin(0, 0.5),
        this.scene.add.text(420, y, `${entry.hearts}/10${marker}`, { fontFamily: COZY_THEME.font, fontSize: '10px', color: selected ? '#ffe19a' : '#a95a5e' }).setOrigin(1, 0.5)]);
    });
    const entry = entries[this.selectedIndex];
    this.nameText.setText(entry.name);
    this.heartsText.setText(`${HEART_FULL.repeat(entry.hearts)}${HEART_EMPTY.repeat(10 - entry.hearts)}  ${entry.hearts}/10`);
    this.traitsText.setText(entry.traits.join('  •  '));
    this.bioText.setText(entry.bio);
    const partner = entry.npcPartnerId ? relationshipView(entry.npcPartnerId).name : null;
    const stage = entry.romanceStage === 'friends' ? 'Friends' : entry.romanceStage[0].toUpperCase() + entry.romanceStage.slice(1);
    const relationshipStyle = entry.relationshipStyle === 'open-minded' ? 'Open-hearted' : 'Prefers exclusivity';
    this.statusText.setText(`${stage}  •  ${relationshipStyle}  •  ${entry.talkedToday ? 'Talked today' : 'Ready to talk'}\nGifts ${entry.giftsThisWeek}/2 this week`
      + (partner ? `\nSeeing ${partner}. Your route stays open, but growing closer takes more time.` : '')
      + (entry.complicated ? '\nYour commitments overlap. People may have feelings about this.' : ''));
    this.interestLabel.setText(entry.romanceStage === 'committed' ? 'Committed' : 'Share your feelings');
    this.interestButton.setFillStyle(entry.romanceStage === 'committed' ? COZY_THEME.mint : COZY_THEME.plum);
    this.chatToggleLabel.setText(`Voice  ${SettingsSystem.get().localNpcChat ? 'ON' : 'OFF'}  ‹ ›`);
    const chatState = SettingsSystem.get().localNpcChat
      ? 'Local voice is ready. Meet a resident, press E, then choose Chat.'
      : 'Local voice is off. Authored Talk still works in town.';
    let memoryLine = 'No saved chats with this person yet.';
    try {
      const notes = residentChatNotes(entry.id);
      if (notes.turns.length) memoryLine = `${notes.turns.length / 2} saved ${notes.turns.length === 2 ? 'chat' : 'chats'} · Open Chat Notes to read them.`;
    } catch (error) { memoryLine = error instanceof Error ? error.message : String(error); }
    this.setFittedText(this.chatInfo, `${chatState}\n${memoryLine}\n${this.notice}`, 10, 8, 5);
    this.refreshPortrait(entry.id);
    if (this.chatLogOpen) this.refreshChatLog();
  }

  /** Open the selected resident's complete social spread without changing relationship state. */
  private openConnections(): void {
    this.connectionsOpen = true;
    this.connectionPage = 0;
    this.connectionTranscriptPager.reset();
    this.connectionsRoot.setVisible(true);
    this.closeButton.setVisible(false);
    this.closeLabel.setVisible(false);
    this.refreshConnections();
    Sfx.play('select');
  }

  /** Return to the resident profile spread while the world remains paused. */
  private closeConnections(): void {
    this.connectionsOpen = false;
    this.connectionsRoot.setVisible(false);
    this.closeButton.setVisible(true);
    this.closeLabel.setVisible(true);
    Sfx.play('select');
  }

  /** Render stable bond rows plus one readable saved conversation for the selected pair. */
  private refreshConnections(): void {
    const selectedResident = relationshipJournal()[this.selectedIndex];
    const entries = residentBondJournal(selectedResident.id);
    this.connectionsTitleText.setText(`${selectedResident.name.toUpperCase()}'S RELATIONSHIPS`);
    this.selectedBondIndex = Phaser.Math.Clamp(this.selectedBondIndex, 0, entries.length - 1);
    this.connectionsListRoot.removeAll(true);
    entries.forEach((entry, index) => {
      const selected = index === this.selectedBondIndex, y = 119 + index * 31;
      const button = cozyPanel(this.scene, 266, y, 342, 27, selected ? COZY_THEME.green : COZY_THEME.pocket, 9)
        .setInteractive({ useHandCursor: true }).setName(`connection-pair-${entry.id}`);
      button.on('pointerdown', () => { this.selectedBondIndex = index; this.connectionPage = 0; Sfx.play('select'); this.refreshConnections(); });
      button.on('pointerover', () => { if (index !== this.selectedBondIndex) button.setFillStyle(COZY_THEME.paperDark); });
      button.on('pointerout', () => { if (index !== this.selectedBondIndex) button.setFillStyle(COZY_THEME.pocket); });
      const otherIndex = entry.residents[0] === selectedResident.id ? 1 : 0;
      this.connectionsListRoot.add([button,
        this.scene.add.text(112, y, entry.names[otherIndex], {
          fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: selected ? COZY_THEME.cream : COZY_THEME.ink,
        }).setOrigin(0, 0.5),
        this.scene.add.text(414, y, `${entry.stage} · ${entry.points}/250`, {
          fontFamily: COZY_THEME.font, fontSize: '9px', color: selected ? COZY_THEME.cream : '#a95a5e',
        }).setOrigin(1, 0.5).setName(`connection-row-status-${entry.id}`)]);
    });
    const entry = entries[this.selectedBondIndex];
    this.connectionNamesText.setText(`${entry.names[0]} & ${entry.names[1]}`);
    this.connectionStageText.setText(entry.stage.toUpperCase());
    this.connectionProgressFill.width = Math.max(1, 184 * entry.points / 250);
    this.connectionContextText.setText(entry.betrayalDay !== null ? `Trust broke on Day ${entry.betrayalDay}.`
      : entry.openAgreement ? 'They agreed that this relationship can stay open.'
      : entry.secret ? 'Someone in this relationship is hiding another closed relationship.'
      : entry.exclusive ? 'They are together and expect exclusivity.' : 'Their connection is still taking shape.');
    const events = townSocialEventsForBond(entry.id);
    this.connectionPage = Phaser.Math.Clamp(this.connectionPage, 0, Math.max(0, events.length - 1));
    if (events.length === 0) {
      this.connectionLocationText.setText('They have not spent time together yet.');
      this.connectionPageText.setText('NO MEETINGS YET');
      this.updatePager(this.connectionTranscriptPageText, this.connectionTranscriptPager,
        'Their friendship grows through real scheduled meetings. Return after their social time to read what they said.');
      return;
    }
    const event = events[this.connectionPage], clock = 6 * 60 + event.minute;
    const hours = Math.floor(clock / 60) % 24, minutes = Math.floor(clock % 60);
    const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const source = event.source === 'local' ? 'Local voice' : 'Authored voice';
    const action = event.action.replace(/-/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
    this.connectionLocationText.setText(`${action}  •  ${socialSpotLabel(event.locationId)}  •  Day ${event.day} at ${time}  •  ${source}`);
    this.connectionPageText.setText(`${this.connectionPage + 1} OF ${events.length}`);
    const speakerName = (id: ResidentId): string => {
      const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
      if (!resident) throw new Error(`Town Connections: missing resident ${id}`);
      return resident.name.toUpperCase();
    };
    const error = event.voiceError ? `\n\nLOCAL VOICE ERROR\n${event.voiceError}` : '';
    const witnesses = event.action !== 'friendly-chat' && event.witnesses.length
      ? `SEEN BY ${event.witnesses.map(id => speakerName(id)).join(', ')}\n\n` : '';
    this.updatePager(this.connectionTranscriptPageText, this.connectionTranscriptPager,
      `${witnesses}${event.lines.map(line => `${speakerName(line.residentId)}\n${line.text}`).join('\n\n')}${error}`);
  }

  /** Open the selected resident's browser-local transcript without offering remote dialogue here. */
  private openChatLog(): void {
    this.chatLogOpen = true;
    this.chatLogPage = 0;
    this.pendingChatDelete = null;
    this.chatLogRoot.setVisible(true);
    this.closeButton.setVisible(false);
    this.closeLabel.setVisible(false);
    this.refreshChatLog();
    Sfx.play('select');
  }

  /** Return to the selected relationship profile. */
  private closeChatLog(): void {
    this.chatLogOpen = false;
    this.chatLogRoot.setVisible(false);
    this.closeButton.setVisible(true);
    this.closeLabel.setVisible(true);
    this.pendingChatDelete = null;
    Sfx.play('select');
  }

  /** Render one saved exchange per page so no player or resident line is clipped. */
  private refreshChatLog(): void {
    const entry = relationshipJournal()[this.selectedIndex];
    this.chatLogTitle.setText(`${entry.name.toUpperCase()} · CHAT NOTES`);
    try {
      const notes = residentChatNotes(entry.id);
      const exchangeCount = notes.turns.length / 2;
      const maxPage = Math.max(0, exchangeCount - 1);
      this.chatLogPage = Phaser.Math.Clamp(this.chatLogPage, 0, maxPage);
      this.updatePager(this.chatSummaryPageText, this.chatSummaryPager,
        notes.summary || 'No compact memory yet. Recent chats stay verbatim until you compact them.');
      if (exchangeCount === 0) {
        this.chatPageText.setText('NO SAVED CHATS');
        this.updatePager(this.chatTranscriptPageText, this.chatTranscriptPager,
          'Talk face-to-face in town and choose Chat. Your completed exchanges will appear here.');
      } else {
        const exchange = exchangeCount - 1 - this.chatLogPage;
        const player = notes.turns[exchange * 2];
        const resident = notes.turns[exchange * 2 + 1];
        this.chatPageText.setText(`${exchange + 1} OF ${exchangeCount}`);
        this.updatePager(this.chatTranscriptPageText, this.chatTranscriptPager,
          `YOU\n${player.text}\n\n${entry.name.toUpperCase()}\n${resident.text}`);
      }
      this.compactLabel.setText(this.compacting ? 'COMPACTING…' : `COMPACT MEMORY · ${exchangeCount}`);
      const pendingSummary = this.pendingChatDelete?.kind === 'summary' && this.pendingChatDelete.residentId === entry.id;
      const visibleExchange = exchangeCount === 0 ? -1 : exchangeCount - 1 - this.chatLogPage;
      const pendingExchange = this.pendingChatDelete?.kind === 'exchange' && this.pendingChatDelete.residentId === entry.id
        && this.pendingChatDelete.exchangeIndex === visibleExchange;
      this.clearSummaryLabel.setText(this.compacting ? 'BUSY' : pendingSummary ? 'CONFIRM CLEAR' : notes.summary ? 'CLEAR MEMORY' : 'NO MEMORY');
      this.deleteExchangeLabel.setText(this.compacting ? 'BUSY' : pendingExchange ? 'CONFIRM DELETE' : exchangeCount ? 'DELETE CHAT' : 'NO CHAT');
    } catch (error) {
      this.chatPageText.setText('MEMORY ERROR');
      this.updatePager(this.chatSummaryPageText, this.chatSummaryPager, error instanceof Error ? error.message : String(error));
      this.updatePager(this.chatTranscriptPageText, this.chatTranscriptPager, '');
      this.compactLabel.setText('COMPACT UNAVAILABLE');
      this.clearSummaryLabel.setText('UNAVAILABLE');
      this.deleteExchangeLabel.setText('UNAVAILABLE');
    }
  }

  /** Require two matching clicks, then clear only the selected resident's compact summary. */
  private clearChatSummary(): void {
    if (this.compacting) return;
    try {
      const entry = relationshipJournal()[this.selectedIndex], notes = residentChatNotes(entry.id);
      if (!notes.summary) { this.pendingChatDelete = null; this.refreshChatLog(); return; }
      if (this.pendingChatDelete?.kind !== 'summary' || this.pendingChatDelete.residentId !== entry.id) {
        this.pendingChatDelete = { kind: 'summary', residentId: entry.id };
        this.refreshChatLog();
        return;
      }
      clearResidentChatSummary(entry.id);
      this.pendingChatDelete = null;
      this.notice = `${entry.name}'s compact memory was cleared.`;
      Sfx.play('select');
      this.refreshChatLog();
    } catch (error) {
      this.pendingChatDelete = null;
      this.notice = error instanceof Error ? error.message : String(error);
      this.refreshChatLog();
    }
  }

  /** Require two matching clicks, then delete only the saved exchange currently on screen. */
  private deleteChatExchange(): void {
    if (this.compacting) return;
    try {
      const entry = relationshipJournal()[this.selectedIndex], notes = residentChatNotes(entry.id);
      const exchangeCount = notes.turns.length / 2;
      if (exchangeCount === 0) { this.pendingChatDelete = null; this.refreshChatLog(); return; }
      const exchangeIndex = exchangeCount - 1 - Phaser.Math.Clamp(this.chatLogPage, 0, exchangeCount - 1);
      if (this.pendingChatDelete?.kind !== 'exchange' || this.pendingChatDelete.residentId !== entry.id
        || this.pendingChatDelete.exchangeIndex !== exchangeIndex) {
        this.pendingChatDelete = { kind: 'exchange', residentId: entry.id, exchangeIndex };
        this.refreshChatLog();
        return;
      }
      deleteResidentChatExchange(entry.id, exchangeIndex);
      this.pendingChatDelete = null;
      this.notice = `${entry.name}'s displayed chat was deleted.`;
      Sfx.play('select');
      this.refreshChatLog();
    } catch (error) {
      this.pendingChatDelete = null;
      this.notice = error instanceof Error ? error.message : String(error);
      this.refreshChatLog();
    }
  }

  /** Ask the local model for a factual summary, then keep the two newest exchanges verbatim. */
  private async compactChatLog(): Promise<void> {
    if (this.compacting) return;
    const entry = relationshipJournal()[this.selectedIndex];
    this.pendingChatDelete = null;
    this.compacting = true;
    this.refreshChatLog();
    try {
      await compactResidentChatNotes(entry.id);
      this.notice = `${entry.name}'s older chats are now a compact memory.`;
      this.chatLogPage = 0;
      Sfx.play('talk');
    } catch (error) {
      this.notice = error instanceof Error ? error.message : String(error);
    } finally {
      this.compacting = false;
      this.refreshChatLog();
    }
  }

  /**
   * Add visible previous and next page buttons around a compact page counter.
   * @param root container that owns the controls; x/y center the page counter.
   * @param name prefix for the controls' debug names; onMove receives -1 (previous) or +1 (next).
   * @returns the page-counter text the caller refreshes.
   */
  private addPageControls(root: Phaser.GameObjects.Container, x: number, y: number, name: string,
    onMove: (delta: number) => void): Phaser.GameObjects.Text {
    // Touch: the drawn arrows are 28×20, too small for a thumb. The invisible hit box adds 10 px each
    // side and 8 px above/below; that stops short of the page count between the two arrows.
    const hit = { hitArea: new Phaser.Geom.Rectangle(-10, -8, 48, 36), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true };
    const previous = cozyPanel(this.scene, x, y - 27, 28, 20, COZY_THEME.paperDark, 7)
      .setInteractive(hit).setName(`${name}-previous-page`);
    const next = cozyPanel(this.scene, x, y + 27, 28, 20, COZY_THEME.paperDark, 7)
      .setInteractive({ ...hit, hitArea: new Phaser.Geom.Rectangle(-10, -8, 48, 36) }).setName(`${name}-next-page`);
    previous.on('pointerdown', () => onMove(-1));
    next.on('pointerdown', () => onMove(1));
    const page = this.scene.add.text(x, y, '1 / 1', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted,
    }).setOrigin(0.5).setName(`${name}-page`);
    root.add([previous, next,
      this.scene.add.text(x, y - 27, '▲', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      this.scene.add.text(x, y + 27, '▼', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      page]);
    return page;
  }

  /** Update one fixed text viewport and its visible page count. */
  private updatePager(label: Phaser.GameObjects.Text, pager: TextPager, value: string): void {
    this.showPage(label, pager.update(value));
  }

  /** Show one-based pager metadata without hiding disabled controls. */
  private showPage(label: Phaser.GameObjects.Text, view: TextPageView): void {
    label.setText(`${view.page} / ${view.pageCount}`);
  }

  /** Move the compact-memory viewport by one page. */
  private moveChatSummaryPage(delta: number): void {
    this.showPage(this.chatSummaryPageText, this.chatSummaryPager.move(delta));
    Sfx.play('select');
  }

  /** Move the selected saved-chat viewport by one page. */
  private moveChatTranscriptPage(delta: number): void {
    this.showPage(this.chatTranscriptPageText, this.chatTranscriptPager.move(delta));
    Sfx.play('select');
  }

  /** Move the selected town-moment viewport by one page. */
  private moveConnectionTranscriptPage(delta: number): void {
    this.showPage(this.connectionTranscriptPageText, this.connectionTranscriptPager.move(delta));
    Sfx.play('select');
  }

  /** Select an older or newer saved exchange and restart its text at page one. */
  private changeChatExchange(delta: number): void {
    this.pendingChatDelete = null;
    this.chatLogPage += delta;
    this.chatTranscriptPager.reset();
    this.refreshChatLog();
    Sfx.play('select');
  }

  /** Select an older or newer town event and restart its text at page one. */
  private changeSocialEvent(delta: number): void {
    this.connectionPage += delta;
    this.connectionTranscriptPager.reset();
    this.refreshConnections();
    Sfx.play('select');
  }

  /** Fit all bounded chat text inside its allotted lines without silently clipping any characters. */
  private setFittedText(target: Phaser.GameObjects.Text, value: string, preferredSize: number, minimumSize: number, maxLines: number): void {
    for (let size = preferredSize; size >= minimumSize; size--) {
      target.setFontSize(size).setText(value);
      const lines = target.getWrappedText(value);
      if (lines.length <= maxLines) {
        // Force the measured breaks because high-density text can otherwise wrap after the panel edge.
        target.setText(lines);
        return;
      }
    }
    throw new Error(`RelationshipUI: bounded chat text does not fit ${maxLines} lines`);
  }

  /**
   * Show the selected resident's pixel-art figure on the journal page.
   * @param id the resident whose figure is shown
   * @throws for an unknown resident
   */
  private refreshPortrait(id: ResidentId): void {
    if (!TOWN_RESIDENTS.some(value => value.id === id)) throw new Error(`Relationships: missing portrait resident ${id}`);
    this.portrait.setTexture(AppearanceTextureSystem.forGame(this.scene.game).residentTextureFor(id), 0).setOrigin(0.5).setScale(3)
      .setPosition(831, 211);
  }

  /** Advance the explicit romance state machine and show its authored result. */
  private expressInterest(): void {
    // A relationship action supersedes any older speech request. Its result must not overwrite authored progress.
    const entry = relationshipJournal()[this.selectedIndex];
    const result = expressInterestInResident(entry.id);
    this.notice = result.line;
    Sfx.play(result.changed ? 'talk' : 'select');
    this.refresh();
  }

  /** Persist the browser-local opt-in. This setting never enters a character save. */
  private toggleChat(): void {
    try {
      const enabled = !SettingsSystem.get().localNpcChat;
      SettingsSystem.update({ localNpcChat: enabled });
      this.notice = enabled ? 'Local voice is on. Meet a resident and choose Chat.' : 'Local voice is off.';
      Sfx.play('select');
    } catch (error) { this.notice = error instanceof Error ? error.message : String(error); }
    this.refresh();
  }

  /** Page only the text panel beneath the pointer while the journal is open. */
  private bindWheel(): void {
    const handler = (pointer: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _deltaX: number,
      deltaY: number, _deltaZ: number): void => {
      if (!GameState.instance.relationshipJournalOpen || deltaY === 0) return;
      const point = uiPoint(this.scene, pointer);
      if (point.x < 508 || point.x > 880) return;
      const direction = deltaY > 0 ? 1 : -1;
      if (this.chatLogOpen && point.y >= 109 && point.y <= 193) {
        this.moveChatSummaryPage(direction);
      } else if (this.chatLogOpen && point.y >= 227 && point.y <= 395) {
        this.moveChatTranscriptPage(direction);
      } else if (this.connectionsOpen && point.y >= 227 && point.y <= 393) {
        this.moveConnectionTranscriptPage(direction);
      }
    };
    this.scene.input.on('wheel', handler);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.input.off('wheel', handler));
  }

  /** Bind journal navigation and settings shortcuts to the scene keyboard lifecycle. */
  private bindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;
    const handler = (event: KeyboardEvent): void => {
      if (!GameState.instance.relationshipJournalOpen || this.keyboardEvents.has(event)) return;
      this.keyboardEvents.add(event);
      if (this.chatLogOpen) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          this.changeChatExchange(event.key === 'ArrowLeft' ? 1 : -1);
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const direction = event.key === 'ArrowUp' ? -1 : 1;
          if (event.shiftKey) this.moveChatSummaryPage(direction);
          else this.moveChatTranscriptPage(direction);
          return;
        }
      }
      if (this.connectionsOpen && (event.key === 'PageUp' || event.key === 'PageDown')) {
        event.preventDefault();
        this.moveConnectionTranscriptPage(event.key === 'PageUp' ? -1 : 1);
        return;
      }
      if (this.connectionsOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        this.changeSocialEvent(event.key === 'ArrowLeft' ? 1 : -1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        if (this.connectionsOpen) {
          const count = residentBondJournal(relationshipJournal()[this.selectedIndex].id).length;
          this.selectedBondIndex = (this.selectedBondIndex + direction + count) % count;
          this.connectionPage = 0; this.connectionTranscriptPager.reset(); Sfx.play('select'); this.refreshConnections(); return;
        }
        this.selectedIndex = (this.selectedIndex + direction + TOWN_RESIDENTS.length) % TOWN_RESIDENTS.length;
        this.chatSummaryPager.reset(); this.chatTranscriptPager.reset();
        this.notice = 'Find them in town to use authored Talk or optional Chat.'; Sfx.play('select'); this.refresh(); return;
      }
      if (event.altKey && event.code === 'KeyF' && !event.repeat) { event.preventDefault(); this.expressInterest(); return; }
      if (event.altKey && event.code === 'KeyC' && !event.repeat) { event.preventDefault(); this.toggleChat(); return; }
    };
    keyboard.on('keydown', handler);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', handler));
  }
}
