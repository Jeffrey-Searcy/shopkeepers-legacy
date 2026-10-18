/**
 * Transient input ownership for the route atlas.
 * This state never enters a save and exists only so one Escape press closes one modal.
 */
let worldRoutesOpen = false;

/** Read whether the route atlas currently owns pause input. */
export function isWorldRoutesModalOpen(): boolean { return worldRoutesOpen; }

/** Set route-atlas input ownership after the caller has validated its UI transition. */
export function setWorldRoutesModalOpen(open: boolean): void {
  if (typeof open !== 'boolean') throw new Error('World routes modal state must be true or false');
  worldRoutesOpen = open;
}
