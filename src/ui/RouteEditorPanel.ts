/** Crisp native controls for the isolated NPC route workshop; Phaser owns only the map viewport. */
import './route-editor.css';
import { NPC_ROUTE_ACTIVITY_CATEGORIES, NPC_ROUTE_WEEKDAYS, type NpcRouteActivityCategory, type NpcRouteDayDraft,
  type NpcRouteStopDraft } from '../debug/NpcRouteDraft';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import type { ResidentId } from '../config/ResidentRelationships';

export type RouteEditorTool = 'edit' | 'add-stop' | 'pan';

/** Scene actions exposed to semantic DOM controls. */
export interface RouteEditorActions {
  resident(id: ResidentId): void;
  weekday(day: number): void;
  tool(tool: RouteEditorTool): void;
  stop(id: string): void;
  note(value: string): void;
  stopField(id: string, field: 'category' | 'label' | 'reason' | 'arrive' | 'leave', value: string | number): void;
  stopTimes(id: string, arrive: number, leave: number): void;
  removeStop(): void;
  removeWaypoint(): void;
  undo(): void;
  redo(): void;
  save(): void;
  export(): void;
  import(file: File): void;
  reset(): void;
  zoom(direction: number): void;
  frame(): void;
  play(): void;
  preview(minute: number): void;
}

/** Convert minutes since 06:00 to one native time input value. */
function timeValue(minutes: number): string {
  const total = (6 * 60 + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Format one route minute as a readable 12-hour choice. */
function timeLabel(minutes: number): string {
  const total = (6 * 60 + minutes) % (24 * 60), hour = Math.floor(total / 60), minute = total % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Own the editor chrome and remove every native node when its scene shuts down. */
export class RouteEditorPanel {
  readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly stopList: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly note: HTMLTextAreaElement;
  private readonly previewLabel: HTMLElement;
  private readonly previewRange: HTMLInputElement;
  private readonly playButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly removeStopButton: HTMLButtonElement;
  private readonly removeWaypointButton: HTMLButtonElement;
  private readonly tools = new Map<RouteEditorTool, HTMLButtonElement>();

  /** Build a cartographer-style authoring desk with all primary controls outside the map. */
  constructor(private readonly actions: RouteEditorActions) {
    this.root = document.createElement('section');
    this.root.className = 'route-editor';
    this.root.setAttribute('aria-label', 'NPC route workshop');
    this.root.innerHTML = `
      <header class="route-editor-header"><div><span class="route-editor-kicker">SHOPKEEPER’S LEGACY · DEVELOPMENT</span><h1>Resident routes <span>Weekly workshop</span></h1></div><div data-area="primary" class="route-editor-actions"></div></header>
      <div class="route-editor-map-guide"><strong data-area="map-guide-label">EDIT ROUTE</strong><span data-area="map-guide-copy">Drag a numbered stop. Click a gold line to add a bend point.</span></div>
      <aside class="route-editor-left">
        <section><h2>Resident & day</h2><label>Resident<select data-area="resident"></select></label><label>Weekday<select data-area="weekday"></select></label></section>
        <section><h2>Draw on the map</h2><div class="route-editor-tools" data-area="tools"></div><p><strong>Stops</strong> hold a time and reason. <strong>Bend points</strong> only shape the walking line between stops.</p></section>
        <section><h2>Stops</h2><div class="route-editor-stop-list" data-area="stops"></div><div class="route-editor-pair" data-area="stop-actions"></div></section>
        <section><h2>Day context</h2><textarea data-area="note" maxlength="240" rows="4"></textarea></section>
      </aside>
      <aside class="route-editor-right"><section><h2>Selected stop</h2><div data-area="inspector"></div></section><section><h2>Preview the day</h2><div class="route-editor-preview"><strong data-area="preview-label"></strong><input data-area="preview-range" type="range" min="0" max="1080" step="5"></div><div class="route-editor-pair" data-area="preview-actions"></div></section><section><h2>View & history</h2><div class="route-editor-pair" data-area="history"></div><div class="route-editor-pair" data-area="view"></div></section><section><h2>Draft file</h2><div class="route-editor-pair" data-area="files"></div><div data-area="reset"></div><p data-area="saved">Draft is up to date</p></section><div class="route-editor-safe"><strong>Safe design draft</strong><p>This page never reads or writes an adventure save. Export the JSON when the week feels alive.</p></div></aside>
      <footer class="route-editor-footer"><strong>ROUTE WORKSHOP</strong><span role="status" aria-live="polite" data-area="status">Choose a resident and shape one day.</span></footer>`;
    document.body.append(this.root);
    this.status = this.area('status'); this.stopList = this.area('stops'); this.inspector = this.area('inspector');
    this.note = this.area('note') as HTMLTextAreaElement; this.previewLabel = this.area('preview-label');
    this.previewRange = this.area('preview-range') as HTMLInputElement;
    for (const resident of TOWN_RESIDENTS) this.option(this.area('resident') as HTMLSelectElement, resident.id, resident.name);
    NPC_ROUTE_WEEKDAYS.forEach((day, index) => this.option(this.area('weekday') as HTMLSelectElement, String(index), day));
    (this.area('resident') as HTMLSelectElement).addEventListener('change', event => this.actions.resident((event.target as HTMLSelectElement).value as ResidentId));
    (this.area('weekday') as HTMLSelectElement).addEventListener('change', event => this.actions.weekday(Number((event.target as HTMLSelectElement).value)));
    this.note.addEventListener('change', () => this.actions.note(this.note.value));
    for (const [tool, label] of [['edit', '✦ Edit route'], ['add-stop', '+ Add stop'], ['pan', '✥ Move map']] as const) {
      const button = this.button('tools', label, () => this.actions.tool(tool), `route-tool-${tool}`);
      button.setAttribute('aria-pressed', String(tool === 'edit')); this.tools.set(tool, button);
    }
    this.removeStopButton = this.button('stop-actions', '− Remove selected stop', this.actions.removeStop, 'route-remove-stop');
    this.playButton = this.button('preview-actions', '▶ Play', this.actions.play, 'route-preview-play');
    this.removeWaypointButton = this.button('preview-actions', 'Remove selected bend', this.actions.removeWaypoint, 'route-remove-waypoint');
    this.previewRange.addEventListener('input', () => this.actions.preview(Number(this.previewRange.value)));
    this.undoButton = this.button('history', '↶ Undo', this.actions.undo, 'route-undo');
    this.redoButton = this.button('history', '↷ Redo', this.actions.redo, 'route-redo');
    this.button('view', '− Zoom', () => this.actions.zoom(-1), 'route-zoom-out');
    this.button('view', '+ Zoom', () => this.actions.zoom(1), 'route-zoom-in');
    this.button('view', 'Whole Town', this.actions.frame, 'route-frame').classList.add('route-editor-wide');
    this.saveButton = this.button('primary', 'Save draft', this.actions.save, 'route-save');
    this.button('primary', 'Export JSON', this.actions.export, 'route-export').classList.add('route-editor-primary');
    this.button('files', 'Import', () => file.click(), 'route-import');
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('aria-label', 'Import NPC route draft');
    file.addEventListener('change', () => { if (file.files?.length === 1) this.actions.import(file.files[0]); file.value = ''; });
    this.root.append(file);
    this.button('files', 'Export', this.actions.export, 'route-export-copy');
    this.button('reset', 'Reset all routes…', this.actions.reset, 'route-reset').classList.add('route-editor-reset');
  }

  /** Find one required fixed region and fail visibly if the static template drifts. */
  private area(name: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`[data-area="${name}"]`);
    if (!element) throw new Error(`RouteEditorPanel: missing ${name} region.`);
    return element;
  }

  /** Add one native button whose event is owned by the scene callback. */
  private button(area: string, label: string, action: () => void, id: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.id = id;
    button.addEventListener('click', action); this.area(area).append(button); return button;
  }

  /** Add one safe text-only option. */
  private option(select: HTMLSelectElement, value: string, label: string): void {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }

  /** Rebuild selected route fields without placing user-authored text into HTML. */
  render(residentId: ResidentId, weekday: number, day: NpcRouteDayDraft, selectedStopId: string,
    selectedWaypoint: number | null, previewMinute: number, playing: boolean): void {
    (this.area('resident') as HTMLSelectElement).value = residentId;
    (this.area('weekday') as HTMLSelectElement).value = String(weekday);
    this.note.value = day.note;
    this.stopList.replaceChildren();
    day.stops.forEach((stop, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'route-editor-stop';
      button.id = `route-stop-${stop.id}`; button.setAttribute('aria-pressed', String(stop.id === selectedStopId));
      const number = document.createElement('strong'); number.textContent = String(index + 1);
      const copy = document.createElement('span'); copy.textContent = `${stop.label} · ${timeValue(stop.arrive)}`;
      button.append(number, copy); button.addEventListener('click', () => this.actions.stop(stop.id)); this.stopList.append(button);
    });
    const selected = day.stops.find(stop => stop.id === selectedStopId);
    if (!selected) throw new Error(`RouteEditorPanel: missing selected stop ${selectedStopId}.`);
    const selectedIndex = day.stops.indexOf(selected);
    this.removeStopButton.disabled = selectedIndex === 0 || selectedIndex === day.stops.length - 1;
    this.removeWaypointButton.disabled = selectedWaypoint === null;
    this.renderInspector(selected, selectedIndex, day.stops.length, selectedWaypoint);
    this.preview(previewMinute, playing, '');
  }

  /** Build labeled inputs for the selected stop; native change events make invalid edits atomic. */
  private renderInspector(stop: NpcRouteStopDraft, index: number, count: number, waypoint: number | null): void {
    this.inspector.replaceChildren();
    const locked = index === 0 || index === count - 1;
    this.inspector.append(this.field('Name', 'text', stop.label, value => this.actions.stopField(stop.id, 'label', value), false, 48));
    this.inspector.append(this.categoryField(stop.id, stop.category, locked));
    const timeGrid = document.createElement('div'); timeGrid.className = 'route-editor-time-grid';
    const arrive = this.timeSelect('Arrive', 'route-arrive', stop.arrive, locked);
    const leave = this.timeSelect('Leave', 'route-leave', stop.leave, locked);
    timeGrid.append(arrive.label, leave.label); this.inspector.append(timeGrid);
    const applyTimes = document.createElement('button'); applyTimes.type = 'button'; applyTimes.id = 'route-apply-times';
    applyTimes.className = 'route-editor-apply-times'; applyTimes.textContent = 'Apply times'; applyTimes.disabled = locked;
    applyTimes.addEventListener('click', () => this.actions.stopTimes(stop.id, Number(arrive.select.value), Number(leave.select.value)));
    this.inspector.append(applyTimes);
    const reason = document.createElement('label'); reason.textContent = 'Reason / context';
    const textarea = document.createElement('textarea'); textarea.rows = 5; textarea.maxLength = 180; textarea.value = stop.reason;
    textarea.addEventListener('change', () => this.actions.stopField(stop.id, 'reason', textarea.value)); reason.append(textarea); this.inspector.append(reason);
    const coordinates = document.createElement('p'); coordinates.className = 'route-editor-coordinates';
    coordinates.textContent = `Tile ${stop.tx}, ${stop.ty} · Route into this stop has ${stop.via.length} bend point${stop.via.length === 1 ? '' : 's'}${waypoint === null ? '' : ` · selected bend ${waypoint + 1}`}`;
    this.inspector.append(coordinates);
    if (locked) {
      const note = document.createElement('p'); note.className = 'route-editor-lock'; note.textContent = 'Home anchors stay fixed at 6 AM and midnight.'; this.inspector.append(note);
    }
  }

  /** Create one input row and defer strict parsing to the route contract. */
  private field(label: string, type: string, value: string, action: (value: string) => void,
    disabled = false, maxLength?: number): HTMLLabelElement {
    const row = document.createElement('label'); row.textContent = label;
    const input = document.createElement('input'); input.type = type; input.value = value; input.disabled = disabled;
    if (maxLength) input.maxLength = maxLength; input.addEventListener('change', () => action(input.value)); row.append(input); return row;
  }

  /** Build one explicit activity-purpose selector for the selected route stop. */
  private categoryField(stopId: string, value: NpcRouteActivityCategory, disabled: boolean): HTMLLabelElement {
    const label = document.createElement('label'); label.textContent = 'Activity type';
    const select = document.createElement('select'); select.id = 'route-category'; select.disabled = disabled;
    for (const category of NPC_ROUTE_ACTIVITY_CATEGORIES) {
      const option = document.createElement('option'); option.value = category;
      option.textContent = `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`; select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => this.actions.stopField(stopId, 'category', select.value as NpcRouteActivityCategory));
    label.append(select); return label;
  }

  /** Build one readable 15-minute route-time selector while retaining an existing off-grid value. */
  private timeSelect(labelText: string, id: string, value: number, disabled: boolean): { label: HTMLLabelElement; select: HTMLSelectElement } {
    const label = document.createElement('label'); label.textContent = labelText;
    const select = document.createElement('select'); select.id = id; select.disabled = disabled;
    const minutes = Array.from({ length: 73 }, (_entry, index) => index * 15);
    if (!minutes.includes(value)) minutes.push(value);
    minutes.sort((left, right) => left - right);
    for (const minute of minutes) {
      const option = document.createElement('option'); option.value = String(minute); option.textContent = timeLabel(minute); select.append(option);
    }
    select.value = String(value); label.append(select); return { label, select };
  }

  /** Update the active map tool without rebuilding focused form controls. */
  tool(tool: RouteEditorTool): void {
    for (const [name, button] of this.tools) button.setAttribute('aria-pressed', String(name === tool));
    if (tool === 'add-stop') {
      this.mapMessage('ADD A TIMED STOP', 'Click an open road tile. The new stop will appear there with editable time and context.');
    } else if (tool === 'pan') {
      this.mapMessage('MOVE THE MAP', 'Drag the map to look around. Use the mouse wheel to zoom.');
    } else {
      this.mapMessage('EDIT ROUTE', 'Drag a numbered stop or diamond. Click a gold line to add a bend point.');
    }
  }

  /** Put the next map action or placement failure where the player is already looking. */
  mapMessage(labelText: string, copyText: string, error = false): void {
    const guide = this.root.querySelector<HTMLElement>('.route-editor-map-guide');
    if (!guide) throw new Error('RouteEditorPanel: map guide is missing.');
    this.area('map-guide-label').textContent = labelText;
    this.area('map-guide-copy').textContent = copyText;
    guide.classList.toggle('is-error', error);
  }

  /** Update history and saved-state actions. */
  history(undo: boolean, redo: boolean, dirty: boolean): void {
    this.undoButton.disabled = !undo; this.redoButton.disabled = !redo;
    const saved = this.area('saved'); saved.textContent = dirty ? '● Unsaved route changes' : '✓ Draft is up to date';
    saved.classList.toggle('is-dirty', dirty); this.saveButton.textContent = dirty ? 'Save draft •' : 'Save draft';
  }

  /** Update preview clock, state, and optional activity label. */
  preview(minute: number, playing: boolean, activity: string): void {
    this.previewRange.value = String(Math.max(0, Math.min(1080, Math.floor(minute))));
    this.previewLabel.textContent = `${timeValue(Number(this.previewRange.value))}${activity ? ` · ${activity}` : ''}`;
    this.playButton.textContent = playing ? '❚❚ Pause' : '▶ Play';
  }

  /** Show guidance or an explicit error with text and color. */
  message(message: string, error = false): void {
    this.status.textContent = message; this.status.classList.toggle('is-error', error);
  }

  /** Return the unobstructed map rectangle in CSS pixels. */
  viewport(): { x: number; y: number; width: number; height: number } {
    const left = this.root.querySelector<HTMLElement>('.route-editor-left'), right = this.root.querySelector<HTMLElement>('.route-editor-right');
    const header = this.root.querySelector<HTMLElement>('.route-editor-header'), footer = this.root.querySelector<HTMLElement>('.route-editor-footer');
    if (!left || !right || !header || !footer) throw new Error('RouteEditorPanel: viewport regions are missing.');
    return { x: left.getBoundingClientRect().right, y: header.getBoundingClientRect().bottom,
      width: right.getBoundingClientRect().left - left.getBoundingClientRect().right,
      height: footer.getBoundingClientRect().top - header.getBoundingClientRect().bottom };
  }

  /** Remove all route controls when the scene shuts down. */
  destroy(): void { this.root.remove(); }
}
