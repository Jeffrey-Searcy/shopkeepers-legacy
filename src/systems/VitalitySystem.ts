/**
 * VitalitySystem — every rule that changes the keeper's food buffs and mana.
 *
 * The saved record lives in GameState.vitality (see VitalityState.ts). This system:
 *  - eats or drinks one edible item: removes it from the bag, restores stamina, starts or extends its buff;
 *  - grants a buff directly (a resident's chat offer, see ResidentOfferSystem);
 *  - answers what the running buffs change: tool stamina cost, chat friendship bonus, walk speed;
 *  - lists running buffs with minutes left, for the HUD;
 *  - mana: Nyra teaches it (learnMana), meditation trains it (one max point per game hour of sitting
 *    still, playtester's request), sleep refills it, and the Mend spell spends it for stamina.
 *
 * Meditation is a runtime flag (GameState.meditating), never saved. TimeSystem.advance feeds the
 * real elapsed game minutes to meditate(); BaseWorldScene stops it when the keeper moves or acts.
 *
 * Buff time uses the game clock, not real time, so pausing or an open conversation also pauses buffs
 * (TimeSystem freezes the clock then). Expired entries are dropped whenever the record is read.
 */
import { GameState } from '../state/GameState';
import { STAMINA_MAX, TOOL_STAMINA_COST } from '../config/GameConfig';
import { ITEM_CATALOG } from '../config/Items';
import { BUFFS, BUFF_IDS, CHEER_CHAT_BONUS, MAX_BUFF_MINUTES, QUICK_STEP_SPEED_SCALE, WELL_FED_TOOL_COST, consumableFor, type BuffId } from '../config/Consumables';
import { absoluteMinute, MANA_MAX_CAP, MANA_START_MAX, MEDITATION_MINUTES_PER_POINT } from './VitalityState';
import { Sfx } from './SfxSystem';

/** Meditation game minutes that restore one current mana point. */
export const MEDITATION_MINUTES_PER_RESTORE = 30;
/** Mana the Mend spell costs. */
export const MEND_MANA_COST = 1;
/** Stamina the Mend spell restores. */
export const MEND_STAMINA = 10;

/**
 * Game minutes meditated since the keeper last sat down. Runtime only; it only paces the
 * restore of current mana (one point per MEDITATION_MINUTES_PER_RESTORE), so it resets on each sit.
 */
let sessionMinutes = 0;

/** Result of one eat or drink attempt. `ok` false means nothing changed. */
export interface ConsumeResult {
  ok: boolean;
  message: string;
}

/** One running buff for the HUD. */
export interface BuffView {
  id: BuffId;
  label: string;
  effect: string;
  color: number;
  /** Whole game minutes left, at least 1. */
  minutesLeft: number;
}

/** The current absolute game minute. */
function now(): number {
  const gs = GameState.instance;
  return absoluteMinute(gs.day, gs.timeOfDay);
}

/** Drop buffs whose end time has passed. Safe to call every frame. */
function prune(): void {
  const vitality = GameState.instance.vitality, current = now();
  if (vitality.buffs.some(buff => buff.until <= current)) vitality.buffs = vitality.buffs.filter(buff => buff.until > current);
}

export const VitalitySystem = {
  /**
   * True when the item can be eaten or drunk.
   * @param item inventory item id
   */
  isConsumable(item: string): boolean {
    return consumableFor(item) !== null;
  },

  /**
   * The bag button text for an edible item, e.g. "Eat · +35 stamina · Well Fed".
   * @param item an edible item id
   * @throws when the item is not edible
   */
  actionLabel(item: string): string {
    const def = consumableFor(item);
    if (!def) throw new Error(`Vitality: "${item}" is not edible`);
    return [def.verb, `+${def.stamina} stamina`, ...(def.buff ? [BUFFS[def.buff.id].label] : [])].join(' · ');
  },

  /**
   * Eat or drink one of `item`. Refuses (and changes nothing) when stamina is full and the item gives no buff.
   * @param item an edible item id the keeper holds
   * @returns what happened, for a toast
   * @throws when the item is not edible or not in the bag (callers check first)
   */
  consume(item: string): ConsumeResult {
    const def = consumableFor(item);
    if (!def) throw new Error(`Vitality: "${item}" is not edible`);
    const gs = GameState.instance, label = ITEM_CATALOG[item].label;
    if (!def.buff && gs.player.stamina >= STAMINA_MAX) return { ok: false, message: 'You are full of energy. Save it for later.' };
    if (!gs.removeItem(item, 1)) throw new Error(`Vitality: no ${item} in the bag to ${def.verb.toLowerCase()}`);
    const gained = Math.min(def.stamina, STAMINA_MAX - gs.player.stamina);
    gs.player.stamina += gained;
    const parts = [`${def.verb === 'Eat' ? 'Ate' : 'Drank'} ${label}`];
    if (gained > 0) parts.push(`+${gained} stamina`);
    if (def.buff) {
      this.grantBuff(def.buff.id, def.buff.minutes);
      parts.push(`${BUFFS[def.buff.id].label}: ${BUFFS[def.buff.id].effect.toLowerCase()}`);
    }
    return { ok: true, message: parts.join(' · ') };
  },

  /**
   * Start a buff, or refresh it when it already runs.
   * @param id buff id
   * @param minutes game minutes it lasts, 1 to MAX_BUFF_MINUTES (the save validator's limit)
   * @throws when `minutes` is out of range
   */
  grantBuff(id: BuffId, minutes: number): void {
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_BUFF_MINUTES) throw new Error(`Vitality: buff length ${minutes} is invalid`);
    prune();
    // why: getting the same buff again refreshes its timer; it never stacks or shortens a longer one.
    const until = Math.ceil(now()) + minutes;
    const buffs = GameState.instance.vitality.buffs, existing = buffs.find(buff => buff.id === id);
    if (existing) existing.until = Math.max(existing.until, until);
    else buffs.push({ id, until });
  },

  /**
   * True while the buff is running.
   * @param id buff id
   */
  hasBuff(id: BuffId): boolean {
    prune();
    return GameState.instance.vitality.buffs.some(buff => buff.id === id);
  },

  /** Running buffs in HUD order, with minutes left. */
  activeBuffs(): BuffView[] {
    prune();
    const current = now(), buffs = GameState.instance.vitality.buffs;
    return BUFF_IDS.flatMap(id => {
      const buff = buffs.find(entry => entry.id === id);
      // why: `until` is rounded up to a whole minute when the buff starts, so rounding the time left up
      // too would show a fresh 3-hour buff as "3h 01m". Round down; a running buff still shows at least 1m.
      return buff ? [{ id, ...BUFFS[id], minutesLeft: Math.max(1, Math.floor(buff.until - current)) }] : [];
    });
  },

  /** Stamina one tool use costs right now. Well Fed lowers it. */
  toolStaminaCost(): number {
    return this.hasBuff('well-fed') ? WELL_FED_TOOL_COST : TOOL_STAMINA_COST;
  },

  /** Extra friendship each chat reply gives right now. Cheer raises it. */
  chatFriendshipBonus(): number {
    return this.hasBuff('cheer') ? CHEER_CHAT_BONUS : 0;
  },

  /** Walk speed multiplier right now. Quick Step raises it. */
  moveSpeedScale(): number {
    return this.hasBuff('quick-step') ? QUICK_STEP_SPEED_SCALE : 1;
  },

  /** True once a resident taught the keeper to feel mana. */
  hasMana(): boolean {
    return GameState.instance.vitality.mana !== null;
  },

  /**
   * Give the keeper a small, full mana pool (Nyra's 'teach-mana' chat offer).
   * @throws when the keeper already has mana (the offer gate checks this first)
   */
  learnMana(): void {
    const vitality = GameState.instance.vitality;
    if (vitality.mana !== null) throw new Error('Vitality: the keeper already knows mana');
    vitality.mana = { current: MANA_START_MAX, max: MANA_START_MAX, practice: 0 };
  },

  /** True while the keeper sits in meditation. */
  isMeditating(): boolean {
    return GameState.instance.meditating;
  },

  /**
   * Sit down to meditate. The clock keeps running; TimeSystem feeds the minutes to meditate().
   * @throws when the keeper has no mana yet (the HUD only shows the button after learning)
   */
  startMeditating(): void {
    if (!this.hasMana()) throw new Error('Vitality: the keeper cannot meditate before learning mana');
    sessionMinutes = 0;
    GameState.instance.meditating = true;
  },

  /** Stand up. Progress already counted is kept. Safe to call when not meditating. */
  stopMeditating(): void {
    GameState.instance.meditating = false;
  },

  /**
   * Count game minutes of meditation. Does nothing when the keeper is not meditating.
   * Each MEDITATION_MINUTES_PER_POINT minutes raise max mana by one (up to MANA_MAX_CAP); each
   * MEDITATION_MINUTES_PER_RESTORE minutes of this sitting restore one current point.
   * @param minutes game minutes that really passed on the clock (TimeSystem passes the clamped amount)
   * @returns true when max mana grew, so a caller can announce it
   */
  meditate(minutes: number): boolean {
    const gs = GameState.instance;
    if (!gs.meditating || minutes <= 0) return false;
    const mana = gs.vitality.mana;
    if (mana === null) throw new Error('Vitality: meditating without mana');
    const restoredBefore = Math.floor(sessionMinutes / MEDITATION_MINUTES_PER_RESTORE);
    sessionMinutes += minutes;
    let grew = false;
    // why: at the cap there is nothing left to train; practice stays 0 so the save stays valid.
    if (mana.max < MANA_MAX_CAP) {
      mana.practice += minutes;
      while (mana.practice >= MEDITATION_MINUTES_PER_POINT && mana.max < MANA_MAX_CAP) {
        mana.practice -= MEDITATION_MINUTES_PER_POINT;
        mana.max += 1;
        grew = true;
      }
      if (mana.max >= MANA_MAX_CAP) mana.practice = 0;
    }
    const restores = Math.floor(sessionMinutes / MEDITATION_MINUTES_PER_RESTORE) - restoredBefore;
    mana.current = Math.min(mana.max, mana.current + restores);
    return grew;
  },

  /** Refill current mana after a night's sleep. Does nothing before mana is learned. */
  restoreManaOnSleep(): void {
    const mana = GameState.instance.vitality.mana;
    if (mana !== null) mana.current = mana.max;
  },

  /**
   * Cast Mend: spend MEND_MANA_COST mana to restore MEND_STAMINA stamina.
   * Refuses (and changes nothing) when stamina is full or mana is too low.
   * @returns what happened, for a toast
   * @throws when the keeper has no mana yet (the HUD only shows the button after learning)
   */
  castMend(): ConsumeResult {
    const gs = GameState.instance, mana = gs.vitality.mana;
    if (mana === null) throw new Error('Vitality: the keeper cannot cast before learning mana');
    if (gs.player.stamina >= STAMINA_MAX) return { ok: false, message: 'You are full of energy already.' };
    if (mana.current < MEND_MANA_COST) return { ok: false, message: 'Not enough mana. Meditate or sleep to refill it.' };
    mana.current -= MEND_MANA_COST;
    const gained = Math.min(MEND_STAMINA, STAMINA_MAX - gs.player.stamina);
    gs.player.stamina += gained;
    Sfx.play('magic');
    return { ok: true, message: `Mend · +${gained} stamina · ${mana.current}/${mana.max} mana` };
  },
};
