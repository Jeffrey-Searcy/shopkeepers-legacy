/** Native, crisp development controls around the Phaser map viewport; no gameplay state lives here. */
import './map-editor.css';
import type { WorkshopMap } from '../debug/LayoutWorkshop';

/** Editing tools operate on layouts, never on the keeper's inventory or tools. */
export type MapEditorTool = 'move' | 'path' | 'grass' | 'pan';
/** Narrow scene-owned actions keep DOM controls independent of Phaser and persistence. */
export interface MapEditorActions {
  map(map: WorkshopMap): void;
  tool(tool: MapEditorTool): void;
  undo(): void;
  redo(): void;
  zoom(direction: number): void;
  frame(): void;
  shop(): void;
  save(): void;
  preview(): void;
  export(): void;
  import(file: File): void;
  reset(): void;
}

/** Own one development-page panel and remove every native node when its scene shuts down. */
export class MapEditorPanel {
  readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly selection: HTMLElement;
  private readonly saved: HTMLElement;
  private readonly tools = new Map<MapEditorTool, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;

  /** Build semantic controls with keyboard focus, readable labels and visible error feedback. */
  constructor(actions: MapEditorActions, map: WorkshopMap) {
    const title = map === 'farm' ? 'Farm' : 'Town';
    this.root = document.createElement('section');
    this.root.className = 'map-editor';
    this.root.setAttribute('aria-label', `${title} map editor`);
    this.root.innerHTML = `
      <header class="map-editor-header">
        <div><span class="map-editor-kicker">SHOPKEEPER’S LEGACY · DEVELOPMENT</span><h1>${title} workshop <span>Layout sandbox</span></h1></div>
        <div class="map-editor-actions" data-area="primary"></div>
      </header>
      <aside class="map-editor-sidebar">
        <div class="map-editor-section"><div class="map-editor-pair" data-area="maps"></div><h2>Shape your ${map}</h2><p>Drag the world into place.</p><div class="map-editor-tools" data-area="tools"></div></div>
        <div class="map-editor-section"><h2>View & history</h2><div class="map-editor-pair" data-area="history"></div><div class="map-editor-pair" data-area="zoom"></div><div class="map-editor-pair" data-area="view"></div></div>
        <div class="map-editor-section map-editor-files"><h2>Your layout</h2><div class="map-editor-pair" data-area="files"></div><div data-area="reset"></div><p data-area="saved">No changes yet</p></div>
        <div class="map-editor-help"><strong>A safe place to experiment</strong><p>Your adventure saves stay untouched. Ponds, cliffs and exits stay fixed.</p><p>Drag to move · Wheel to zoom<br>Space + drag to pan<br>⌘ / Ctrl Z to undo</p></div>
      </aside>
      <footer class="map-editor-footer"><strong data-area="selection">Choose an object</strong><span role="status" aria-live="polite" data-area="status">${map === 'farm' ? 'Move the shop, trees, rocks and shipping bin.' : 'Move building plots and greenery. Buildings come later.'}</span></footer>`;
    document.body.append(this.root);
    this.status = this.area('status');
    this.selection = this.area('selection');
    this.saved = this.area('saved');
    // why: the Town has no layout workshop since it became one painting; its button opens the route editor.
    for (const target of ['farm', 'town'] as const) {
      const button = this.button('maps', target === 'farm' ? 'Farm' : 'Town routes', () => actions.map(target), `map-select-${target}`);
      button.setAttribute('aria-pressed', String(target === map));
    }
    this.saveButton = this.button('primary', 'Save draft', actions.save, 'map-save');
    this.button('primary', 'Walk preview ↗', actions.preview, 'map-preview').classList.add('map-editor-primary');
    for (const [tool, label] of [['move', '↖  Move'], ['path', '▰  Path'], ['grass', '✿  Grass'], ['pan', '✥  Pan']] as const) {
      const button = this.button('tools', label, () => actions.tool(tool), `map-tool-${tool}`);
      button.setAttribute('aria-pressed', String(tool === 'move'));
      this.tools.set(tool, button);
    }
    this.undoButton = this.button('history', '↶ Undo', actions.undo, 'map-undo');
    this.redoButton = this.button('history', '↷ Redo', actions.redo, 'map-redo');
    this.button('zoom', '− Zoom', () => actions.zoom(-1), 'map-zoom-out');
    this.button('zoom', '+ Zoom', () => actions.zoom(1), 'map-zoom-in');
    this.button('view', `Whole ${map}`, actions.frame, 'map-frame');
    this.button('view', map === 'farm' ? 'Find shop' : 'Town center', actions.shop, 'map-shop');
    this.button('files', 'Export', actions.export, 'map-export');
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.setAttribute('aria-label', `Import ${map} layout`);
    file.addEventListener('change', () => {
      if (file.files && file.files.length === 1) actions.import(file.files[0]);
      file.value = '';
    });
    this.root.append(file);
    this.button('files', 'Import', () => file.click(), 'map-import');
    this.button('reset', 'Reset to original…', actions.reset, 'map-reset').classList.add('map-editor-reset');
    this.history(false, false, false);
  }

  /** Find a required fixed region; malformed panel templates fail visibly during development. */
  private area(name: string): HTMLElement {
    const area = this.root.querySelector<HTMLElement>(`[data-area="${name}"]`);
    if (!area) throw new Error(`MapEditorPanel: missing ${name} region`);
    return area;
  }

  /** Add one native action button; exceptions are surfaced by the scene-owned action wrapper. */
  private button(area: string, label: string, action: () => void, id: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.id = id;
    button.addEventListener('click', action);
    this.area(area).append(button);
    return button;
  }

  /** Update tool state without replacing focused controls. */
  tool(tool: MapEditorTool): void {
    for (const [name, button] of this.tools) button.setAttribute('aria-pressed', String(name === tool));
  }

  /** Keep undo/redo availability and the unsaved badge in sync with the scene's history. */
  history(undo: boolean, redo: boolean, dirty: boolean): void {
    this.undoButton.disabled = !undo; this.redoButton.disabled = !redo;
    this.saved.textContent = dirty ? '● Unsaved layout changes' : '✓ Draft is up to date';
    this.saved.classList.toggle('is-dirty', dirty);
    // The compact layout hides section notes, so keep its changed-state cue in the always-visible header too.
    this.saveButton.textContent = dirty ? 'Save draft •' : 'Save draft';
    this.saveButton.title = dirty ? 'Save unsaved layout changes' : 'Save this layout draft';
  }

  /** Show placement guidance or errors with text as well as color. */
  message(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('is-error', error);
  }

  /** Offer a direct user-activated link when the browser chooses not to open the requested preview tab. */
  previewLink(url: string): void {
    this.message('Preview requested. If no tab appeared: ');
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Open preview'; this.status.append(link);
  }

  /** Name the selected object and tile without placing labels over game art. */
  select(label: string): void { this.selection.textContent = label; }

  /** Return the unobscured map rectangle in CSS pixels for the Phaser camera viewport. */
  viewport(): { x: number; y: number; width: number; height: number } {
    const sidebar = this.root.querySelector<HTMLElement>('.map-editor-sidebar');
    const header = this.root.querySelector<HTMLElement>('.map-editor-header');
    const footer = this.root.querySelector<HTMLElement>('.map-editor-footer');
    if (!sidebar || !header || !footer) throw new Error('MapEditorPanel: viewport regions missing');
    const side = sidebar.getBoundingClientRect(), top = header.getBoundingClientRect();
    const narrow = window.innerWidth <= 760;
    const x = narrow ? 0 : side.right, y = narrow ? side.bottom : top.bottom;
    return { x, y, width: window.innerWidth - x, height: footer.getBoundingClientRect().top - y };
  }

  /** Dispose native UI; scene shutdown also releases its pointer and keyboard listeners. */
  destroy(): void { this.root.remove(); }
}
