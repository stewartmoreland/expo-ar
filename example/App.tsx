import { ExpoArView, getCapabilities, type Capabilities, type TapEvent } from 'expo-ar';
import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { MeasureHUD } from './features/MeasureHUD';
import { PlacementHUD } from './features/PlacementHUD';
import { type MeasureMode, type Unit } from './features/measurement';
import { useArMeasure } from './features/useArMeasure';
import { useArPlacement } from './features/useArPlacement';

// Dev harness for the expo-ar core (GH #5, phase 5). Two worked features — measurement
// and tap-to-place — composed on the SAME core (session/tracking/raycast/anchors), proving
// it's use-case-agnostic. Run on a PHYSICAL device — ARKit/ARCore don't run in a simulator.
export default function App() {
  // Sync capability probe BEFORE mounting the view, so unsupported devices (and web)
  // branch to a non-AR fallback instead of rendering a dead AR surface.
  const caps = useMemo<Capabilities>(() => {
    try {
      return getCapabilities();
    } catch {
      return { arSupported: false, depthOrLidarAvailable: false };
    }
  }, []);

  if (!caps.arSupported) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackText}>
          AR is not supported on this device. A real app would fall back to expo-camera here.
        </Text>
      </SafeAreaView>
    );
  }

  return <ArRoot />;
}

type DemoMode = 'measure' | 'place';

// Owns the demo selector. Conditionally renders EXACTLY ONE demo (and thus exactly one
// <ExpoArView> / one AR session) at a time — AR allows only one active session app-wide,
// so switching unmounts the old view (releasing the camera) before mounting the new one.
function ArRoot() {
  const [mode, setMode] = useState<DemoMode>('measure');

  return (
    <View style={styles.container}>
      {mode === 'measure' ? <MeasureDemo /> : <PlacementDemo />}

      {/* Segmented switcher persists across the demo swap and is the single source of mode. */}
      <SafeAreaView style={styles.switcherWrap} pointerEvents="box-none">
        <View style={styles.segment}>
          <Pressable
            style={[styles.segmentItem, mode === 'measure' && styles.segmentItemActive]}
            onPress={() => setMode('measure')}>
            <Text style={[styles.segmentTxt, mode === 'measure' && styles.segmentTxtActive]}>
              Measure
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segmentItem, mode === 'place' && styles.segmentItemActive]}
            onPress={() => setMode('place')}>
            <Text style={[styles.segmentTxt, mode === 'place' && styles.segmentTxtActive]}>
              Place
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const UNITS: Unit[] = ['m', 'cm', 'ft', 'in'];

// Measurement demo: tap to drop points; distance/area derive from the core's anchors.
function MeasureDemo() {
  const m = useArMeasure();
  const [unit, setUnit] = useState<Unit>('m');
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance');

  const onTap = (e: { nativeEvent: TapEvent }) => m.addPointAt(e.nativeEvent.x, e.nativeEvent.y);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoArView
        ref={m.ref}
        style={StyleSheet.absoluteFill}
        planeDetection="both"
        depthEnabled
        debug
        onTap={onTap}
        {...m.handlers}
      />
      <MeasureHUD
        mode={measureMode}
        unit={unit}
        ready={m.ready}
        distance={m.distance}
        area={m.area}
        onAdd={m.addPointAtCenter}
        onUndo={m.undo}
        onClear={m.clear}
        onCycleUnit={() => setUnit((u) => UNITS[(UNITS.indexOf(u) + 1) % UNITS.length])}
        onToggleMode={() => setMeasureMode((x) => (x === 'distance' ? 'area' : 'distance'))}
      />
    </View>
  );
}

// Placement demo: tap to drop an anchor + attach a model (built-in cube) at its pose.
function PlacementDemo() {
  const p = useArPlacement();

  const onTap = (e: { nativeEvent: TapEvent }) => void p.placeAt(e.nativeEvent.x, e.nativeEvent.y);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoArView
        ref={p.ref}
        style={StyleSheet.absoluteFill}
        planeDetection="both"
        depthEnabled
        debug
        onTap={onTap}
        {...p.handlers}
      />
      <PlacementHUD
        ready={p.ready}
        count={p.placedCount}
        onPlace={() => p.placeAtCenter()}
        onRemoveLast={p.removeLast}
        onClear={p.clear}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#111',
  },
  fallbackText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  switcherWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  segment: {
    flexDirection: 'row',
    marginBottom: 8,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  segmentItem: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 999 },
  segmentItemActive: { backgroundColor: 'rgba(255,255,255,0.92)' },
  segmentTxt: { color: '#E5E7EB', fontWeight: '600' },
  segmentTxtActive: { color: '#000' },
});
