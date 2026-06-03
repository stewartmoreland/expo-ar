# Example — tap-to-place 3D objects (built on the core)

A second worked feature on the same `expo-ar` core, included specifically to show the core is use-case agnostic: it composes the *same* primitives as measurement (`addAnchor`, `onAnchorsChange`, lifecycle) but produces a completely different experience — placing, moving, and removing 3D models anchored in the real world. Compare it side-by-side with `measurement.md`: the core code is identical; only the feature layer differs.

## What placement adds on top of the core

| Concern | Reuses from core | Adds |
|---|---|---|
| Pick a spot | `addAnchor(x,y)` + `onAnchorsChange` | nothing |
| Decide what to show | anchor `id` + `transform` | `modelUri`, per-anchor model mapping |
| Render | native view (rendering host) | load + attach a model node per anchor; scale/rotate |
| Control | `removeAnchor`, `reset` | `selectedId`, `onModelPlaced`, gesture transforms |

Where measurement turns anchors into *lines + numbers*, placement turns the same anchors into *models*. That's the whole difference.

## 1. Feature contract — `features/placement.ts`

```typescript
import { z } from 'zod';
import type { Anchor } from '../types';

export const PlacedModel = z.object({
  anchorId: z.string(),
  modelUri: z.string(),
  scale: z.number().default(1),
});
export type PlacedModel = z.infer<typeof PlacedModel>;

export const ModelPlacedEvent = z.object({ anchorId: z.string(), modelUri: z.string() });

/** Map the core's anchors to the models the user has placed. */
export const toPlacedModels = (anchors: Anchor[], byId: Record<string, { uri: string; scale: number }>): PlacedModel[] =>
  anchors
    .filter((a) => byId[a.id])
    .map((a) => ({ anchorId: a.id, modelUri: byId[a.id].uri, scale: byId[a.id].scale }));
```

## 2. Feature hook — `useArPlacement`

```tsx
import { useCallback, useRef, useState } from 'react';
import { useArSession } from '../useArSession';

export function useArPlacement(defaultModelUri: string) {
  const ar = useArSession();
  const models = useRef<Record<string, { uri: string; scale: number }>>({});
  const [count, setCount] = useState(0);

  const placeAt = useCallback(async (x: number, y: number, uri = defaultModelUri) => {
    if (!ar.ready) return;
    const res = await ar.ref.current?.addAnchor(x, y); // core raycasts + anchors
    if (res?.id) {
      models.current[res.id] = { uri, scale: 1 };
      setCount((c) => c + 1);
      // Tell the native view to load this model onto this anchor (see §3).
      // await ar.ref.current?.attachModel(res.id, uri);
    }
  }, [ar.ready, defaultModelUri]);

  const remove = useCallback((id: string) => ar.ref.current?.removeAnchor(id), []);

  return { ...ar, placeAt, remove, placedCount: count };
}
```

Wire `placeAt` to the core's `onTap` event (tap anywhere to place) or to a HUD button (place at screen center). Either way, no new session/tracking code.

## 3. Native rendering — attach a model per anchor

Add one feature function to the view contract — `attachModel(anchorId, uri)` — and load a glTF/USDZ onto the anchor. iOS sketch (extends the **open** base view):

```swift
// AsyncFunction("attachModel") { (v: ExpoArView, id: String, uri: String) in v.attachModel(id, uri) }
import SceneKit
extension ExpoArView {
  func attachModel(_ id: String, _ uri: String) {
    guard let anchor = anchorsById[id],
          let scene = try? SCNScene(url: URL(string: uri)!) else { return }
    let node = SCNNode()
    scene.rootNode.childNodes.forEach { node.addChildNode($0) }
    node.simdTransform = anchor.transform        // lock to the anchor's world pose
    sceneView.scene.rootNode.addChildNode(node)
  }
}
```

Android: register the matching `attachModel` `AsyncFunction`, then load the model with SceneView's `ModelNode` and add it under an `AnchorNode` created from the anchor — consult your SceneView version's node API. For real apps prefer ARKit/ARCore's built-in glTF/USDZ loading + an `AnchorNode` so the model tracks the anchor automatically rather than setting a static transform once.

## 4. Optional polish (still just feature layer)

- **Move/scale**: add pan/pinch gestures in the native view, update the model node's transform; the anchor stays put.
- **Reticle preview**: before placing, call the core's `raycast(centerX, centerY)` each frame (throttled) and show a ghost model at that transform.
- **Persistence**: save anchor transforms; on relaunch, re-add anchors and re-attach models. For cross-session world re-localization use ARKit `ARWorldMap` / ARCore Cloud Anchors (a core-level extension, not feature-level).

## The point of including this

Two features — measurement and placement — produce opposite experiences (numbers vs models, ephemeral lines vs persistent objects) from the **same** session, raycast, anchor, depth, and lifecycle code. That's the test of a use-case-agnostic core: if a new feature can be built by adding a hook + a couple of view functions + rendering, without touching the session machinery, the abstraction is right. Build any new AR feature this way.
