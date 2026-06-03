# Example — AR measurement (built on the core)

A worked feature showing how to compose the generic `expo-ar` core into a tape-measure/area tool. It touches **none** of the core session/tracking/lifecycle code — it only (1) reacts to anchors the core already manages, (2) adds measurement math in JS, and (3) extends the native view to draw lines + labels. Use this as the template for composing any feature.

## What measurement adds on top of the core

| Concern | Reuses from core | Adds |
|---|---|---|
| Get a 3D point | `addAnchor(x,y)` + `onAnchorsChange` | nothing |
| Compute geometry | anchor `transform` → position | `distance` / `perimeter` / `area`, unit conversion |
| Show the result | native view (rendering host) | line + label nodes; a 2D HUD readout |
| Control | `pause`/`resume`/`reset` | `mode` prop, `onMeasurementChange` event |

The flow: tap → core raycasts and adds an anchor → `onAnchorsChange` fires → the feature hook recomputes geometry from anchor positions and the native view draws a line between the last two anchors.

## 1. Feature contract & math — `features/measurement.ts`

All AR math is in meters; convert only at the UI edge.

```typescript
import { z } from 'zod';
import { positionOf, type Vec3 } from '../transform';
import type { Anchor } from '../types';

export const Unit = z.enum(['m', 'cm', 'ft', 'in']);
export type Unit = z.infer<typeof Unit>;
export const MeasureMode = z.enum(['distance', 'area']);
export type MeasureMode = z.infer<typeof MeasureMode>;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

export const distance = (a: Vec3, b: Vec3) => norm(sub(a, b));

export const perimeter = (pts: Vec3[], closed = true): number => {
  if (pts.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) t += distance(pts[i], pts[i + 1]);
  if (closed && pts.length > 2) t += distance(pts[pts.length - 1], pts[0]);
  return t;
};

/** Vector-area of a planar polygon in 3D — robust on any plane (floor, tilted table, wall). */
export const area = (pts: Vec3[]): number => {
  if (pts.length < 3) return 0;
  const c = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  c.x /= pts.length; c.y /= pts.length; c.z /= pts.length;
  let s: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < pts.length; i++) {
    const x = cross(sub(pts[i], c), sub(pts[(i + 1) % pts.length], c));
    s = { x: s.x + x.x, y: s.y + x.y, z: s.z + x.z };
  }
  return norm(s) / 2;
};

const M_TO: Record<Unit, number> = { m: 1, cm: 100, ft: 3.280839895, in: 39.37007874 };
export const formatLength = (m: number | null, u: Unit) =>
  m == null ? '—' : `${(m * M_TO[u]).toFixed(u === 'cm' || u === 'in' ? 1 : 2)} ${u}`;
export const formatArea = (m2: number | null, u: Unit) =>
  m2 == null ? '—' : `${m2.toFixed(2)} m²`;

/** Pure derivation from the core's anchors — no AR state of its own. */
export const measure = (anchors: Anchor[]) => {
  const pts = anchors.map((a) => positionOf(a.transform));
  return {
    points: pts,
    distance: pts.length >= 2 ? distance(pts[pts.length - 2], pts[pts.length - 1]) : null,
    perimeter: pts.length >= 2 ? perimeter(pts, false) : null,
    area: pts.length >= 3 ? area(pts) : null,
  };
};
```

## 2. Feature hook — `useArMeasure`

Wraps `useArSession`; adds nothing to the session, just derives geometry from its anchors.

```tsx
import { useMemo } from 'react';
import { useArSession } from '../useArSession';
import { measure } from './measurement';

export function useArMeasure() {
  const ar = useArSession();
  const result = useMemo(() => measure(ar.anchors), [ar.anchors]);
  const addPointAtCenter = async () => {
    if (!ar.ready) return;
    // Use a real screen-center; pass actual view size in production.
    await ar.ref.current?.addAnchor(/* x */ 0.5 * screenW, /* y */ 0.5 * screenH);
  };
  return { ...ar, ...result, addPointAtCenter };
}
```

The core's `removeAnchor`/`reset` already give you undo and clear — call `ar.ref.current?.removeAnchor(lastId)` for undo, `ar.reset()` for clear. No new native lifecycle code.

## 3. 2D HUD — reuse for any readout

Event-driven (updates on tap), so plain RN state is fine; neon-on-glass over the native view.

```tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatLength, formatArea, type MeasureMode, type Unit } from './measurement';

export function MeasureHUD(p: {
  mode: MeasureMode; unit: Unit; ready: boolean;
  distance: number | null; area: number | null;
  onAdd(): void; onUndo(): void; onClear(): void;
}) {
  const primary = p.mode === 'area' ? formatArea(p.area, p.unit) : formatLength(p.distance, p.unit);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={s.reticleWrap} pointerEvents="none"><View style={[s.reticle, !p.ready && s.gated]} /></View>
      <View style={s.pillWrap} pointerEvents="none">
        <View style={s.pill}><Text style={s.pillTxt}>{p.ready ? primary : 'Move device to start…'}</Text></View>
      </View>
      <View style={s.row}>
        <Pressable onPress={p.onUndo} style={s.ghost}><Text style={s.ghostTxt}>Undo</Text></Pressable>
        <Pressable onPress={p.onAdd} disabled={!p.ready} style={[s.primary, !p.ready && s.disabled]}>
          <Text style={s.primaryTxt}>Add point</Text></Pressable>
        <Pressable onPress={p.onClear} style={s.ghost}><Text style={s.ghostTxt}>Clear</Text></Pressable>
      </View>
    </View>
  );
}
const NEON = '#5EEAD4';
const s = StyleSheet.create({
  reticleWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: NEON,
    shadowColor: NEON, shadowOpacity: 0.9, shadowRadius: 8 },
  gated: { borderColor: '#9CA3AF', shadowOpacity: 0 },
  pillWrap: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.55)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.4)' },
  pillTxt: { color: '#F9FAFB', fontSize: 18, fontWeight: '600' },
  row: { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between' },
  primary: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999, backgroundColor: NEON },
  primaryTxt: { color: '#06281f', fontWeight: '700' }, disabled: { opacity: 0.4 },
  ghost: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  ghostTxt: { color: '#E5E7EB', fontWeight: '600' },
});
```

## 4. Native rendering of the line (extend the base view)

World-anchored geometry must be drawn natively so it stays locked in space. Subclass the **open** base view and react to anchor changes. iOS sketch:

```swift
// ios/ExpoArMeasureView.swift — registered as a SEPARATE view "ExpoArMeasure",
// or fold these methods into ExpoArView behind a `mode` prop.
import SceneKit
final class ExpoArMeasureView: ExpoArView {
  private var lineNodes: [SCNNode] = []

  // Call after addAnchor; or override the anchor-change path to redraw.
  func redrawLines() {
    lineNodes.forEach { $0.removeFromParentNode() }; lineNodes.removeAll()
    let positions = anchorsById.values.map { SCNVector3($0.transform.columns.3.x,
      $0.transform.columns.3.y, $0.transform.columns.3.z) }
    for i in 1..<max(positions.count, 1) where positions.count >= 2 {
      let node = cylinderLine(from: positions[i - 1], to: positions[i]) // thin white cylinder
      sceneView.scene.rootNode.addChildNode(node); lineNodes.append(node)
    }
  }
}
```

Android: same idea — on `onAnchorsChange`, rebuild cylinder/line nodes between consecutive anchor poses using your SceneView version's node API. Keep the *math* in the shared TS (`measurement.ts`); the native side only renders.

## Why this is the template

Measurement added one prop (`mode`), one event (`onMeasurementChange` — optional, since JS can derive from `onAnchorsChange`), feature math, and line rendering. The session, tracking, raycast, anchors, depth/LiDAR, and lifecycle all came from the core untouched. Object placement (`examples/object-placement.md`) layers on the same surface differently — proving the core is genuinely use-case agnostic.
