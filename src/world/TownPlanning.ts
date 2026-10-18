/** Town planning shapes shared by ordinary terrain and its workshop. Clearings are not buildings or colliders. */

/** Stable tile rectangle for an unassigned, movable building clearing. */
export interface TownPlot { id: string; tx: number; ty: number; w: number; h: number }

/** Fixed walkable river crossing; axis tells the renderer which way its planks connect the banks. */
export interface TownBridge extends TownPlot { axis: 'horizontal' | 'vertical' }

/** Authored planning metadata; only plots move, while bridges and inert future sites stay fixed. */
export interface TownPlan {
  plots: TownPlot[];
  bridges: TownBridge[];
  futureSites: TownPlot[];
}
