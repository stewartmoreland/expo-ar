import { z } from 'zod';
// TYPE-ONLY import (erased at compile) → this module stays runtime-clean and jest-testable
// without the native module. See features/__tests__/placement.test.ts.
import type { Anchor } from 'expo-ar';

// A model the user has placed: which core anchor it's attached to, what to render, and a
// display scale. `scale` defaults to 1 so callers can omit it.
export const PlacedModel = z.object({
  anchorId: z.string(),
  modelUri: z.string(),
  scale: z.number().default(1),
});
export type PlacedModel = z.infer<typeof PlacedModel>;

// Emitted (in JS) when a model has been attached to an anchor — mirrors how a native
// onModelPlaced event would look, but derivable entirely from the core's anchors.
export const ModelPlacedEvent = z.object({ anchorId: z.string(), modelUri: z.string() });
export type ModelPlacedEvent = z.infer<typeof ModelPlacedEvent>;

/**
 * Map the core's anchors to the models the user has placed. Pure: placement holds no AR
 * state — it only joins the core's `anchors` against a JS-owned anchorId → model map, so
 * anchors removed by the core (removeAnchor/reset) naturally drop out of the result.
 */
export const toPlacedModels = (
  anchors: Anchor[],
  byId: Record<string, { uri: string; scale: number }>
): PlacedModel[] =>
  anchors
    .filter((a) => byId[a.id])
    .map((a) => ({ anchorId: a.id, modelUri: byId[a.id].uri, scale: byId[a.id].scale }));
