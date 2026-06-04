import type { Detection } from 'expo-ar';

import { bboxToRects, formatMeters, placeable, topDetection } from '../detection';

const det = (id: string, confidence: number, worldTransform: number[] | null = null): Detection => ({
  id,
  label: id,
  confidence,
  bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  worldTransform,
});

describe('topDetection', () => {
  it('returns null for an empty batch', () => {
    expect(topDetection([])).toBeNull();
  });

  it('picks the highest-confidence detection', () => {
    const a = det('a', 0.4);
    const b = det('b', 0.9);
    const c = det('c', 0.7);
    expect(topDetection([a, b, c])).toBe(b);
  });
});

describe('placeable', () => {
  it('keeps only detections with a world transform', () => {
    const hit = det('hit', 0.8, new Array(16).fill(0));
    const miss = det('miss', 0.8, null);
    expect(placeable([hit, miss])).toEqual([hit]);
  });
});

describe('bboxToRects', () => {
  it('scales a normalized bbox to pixels for the given canvas size', () => {
    expect(bboxToRects([det('a', 0.5)], { width: 1000, height: 500 })).toEqual([
      { id: 'a', label: 'a', x: 100, y: 100, w: 300, h: 200 },
    ]);
  });
});

describe('formatMeters', () => {
  it('renders a dash for null', () => {
    expect(formatMeters(null)).toBe('—');
  });

  it('uses cm under a meter and meters otherwise', () => {
    expect(formatMeters(0.42)).toBe('42 cm');
    expect(formatMeters(1.5)).toBe('1.50 m');
  });
});
