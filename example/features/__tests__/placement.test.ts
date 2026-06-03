import type { Anchor } from 'expo-ar';

import { PlacedModel, toPlacedModels } from '../placement';

const anchor = (id: string): Anchor => ({ id, transform: new Array(16).fill(0), type: 'point' });

describe('toPlacedModels', () => {
  it('returns an empty list with no anchors', () => {
    expect(toPlacedModels([], {})).toEqual([]);
  });

  it('filters out anchors with no model mapping', () => {
    const anchors = [anchor('a'), anchor('b')];
    const byId = { a: { uri: 'box', scale: 1 } };
    expect(toPlacedModels(anchors, byId)).toEqual([
      { anchorId: 'a', modelUri: 'box', scale: 1 },
    ]);
  });

  it('maps matching anchors to their uri and scale', () => {
    const anchors = [anchor('a'), anchor('b')];
    const byId = { a: { uri: 'chair.glb', scale: 0.5 }, b: { uri: 'lamp.usdz', scale: 2 } };
    expect(toPlacedModels(anchors, byId)).toEqual([
      { anchorId: 'a', modelUri: 'chair.glb', scale: 0.5 },
      { anchorId: 'b', modelUri: 'lamp.usdz', scale: 2 },
    ]);
  });
});

describe('PlacedModel schema', () => {
  it('defaults scale to 1 when omitted', () => {
    expect(PlacedModel.parse({ anchorId: 'a', modelUri: 'box' })).toEqual({
      anchorId: 'a',
      modelUri: 'box',
      scale: 1,
    });
  });
});
