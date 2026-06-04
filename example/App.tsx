import { ExpoArView, getCapabilities, type Capabilities, type TapEvent } from 'expo-ar';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { GeoHUD } from './features/GeoHUD';
import { MeasureHUD } from './features/MeasureHUD';
import { MeasurementLabels } from './features/MeasurementLabels';
import { ModeSwitch, type DemoMode } from './features/ModeSwitch';
import { PlacementHUD } from './features/PlacementHUD';
import { type MeasureMode, type Unit } from './features/measurement';
import { useArGeo } from './features/useArGeo';
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
      return { arSupported: false, depthOrLidarAvailable: false, geoTrackingSupported: false };
    }
  }, []);

  return (
    <SafeAreaProvider>
      {caps.arSupported ? (
        <ArRoot />
      ) : (
        <SafeAreaView style={styles.fallback}>
          <Text style={styles.fallbackText}>
            AR is not supported on this device. A real app would fall back to expo-camera here.
          </Text>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}

// Owns the demo selector. Conditionally renders EXACTLY ONE demo (and thus exactly one
// <ExpoArView> / one AR session) at a time — AR allows only one active session app-wide,
// so switching unmounts the old view (releasing the camera) before mounting the new one.
// The mode switch lives at the TOP; each demo's controls live at the BOTTOM, so chrome
// never overlaps (see theme LAYOUT).
function ArRoot() {
  const [mode, setMode] = useState<DemoMode>('measure');

  return (
    <View style={styles.container}>
      {mode === 'measure' ? <MeasureDemo /> : mode === 'place' ? <PlacementDemo /> : <GeoDemo />}
      <ModeSwitch mode={mode} onChange={setMode} />
    </View>
  );
}

const UNITS: Unit[] = ['m', 'cm', 'ft', 'in'];

// Measurement demo: tap to drop points; distance/area derive from the core's anchors, and
// per-segment labels pin to the object via the opt-in projection stream (emitProjections).
function MeasureDemo() {
  const m = useArMeasure();
  const [unit, setUnit] = useState<Unit>('m');
  const [measureMode, setMeasureMode] = useState<MeasureMode>('distance');

  const onTap = (e: { nativeEvent: TapEvent }) => m.addPointAt(e.nativeEvent.x, e.nativeEvent.y);
  const onCycleUnit = useCallback(
    () => setUnit((u) => UNITS[(UNITS.indexOf(u) + 1) % UNITS.length]),
    []
  );
  const onToggleMode = useCallback(
    () => setMeasureMode((x) => (x === 'distance' ? 'area' : 'distance')),
    []
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoArView
        ref={m.ref}
        style={StyleSheet.absoluteFill}
        planeDetection="both"
        depthEnabled
        debug
        emitProjections
        onTap={onTap}
        {...m.handlers}
      />
      <MeasurementLabels
        anchors={m.anchors}
        segments={m.segments}
        projected={m.projected}
        unit={unit}
      />
      <MeasureHUD
        mode={measureMode}
        unit={unit}
        ready={m.ready}
        count={m.points.length}
        distance={m.distance}
        perimeter={m.perimeter}
        area={m.area}
        onAdd={m.addPointAtCenter}
        onUndo={m.undo}
        onClear={m.clear}
        onCycleUnit={onCycleUnit}
        onToggleMode={onToggleMode}
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

// Geospatial demo: switch the session to VPS/geo tracking (trackingMode="geo"), wait until
// localized with good accuracy, then drop an anchor at the device's real lat/long. Geo anchors
// flow through the SAME core onAnchorsChange (type "geo") — the demo only adds the geo source
// and localization gating. Requires being outdoors in VPS-covered, well-lit conditions.
function GeoDemo() {
  const g = useArGeo();
  const [vps, setVps] = useState('unknown');
  const checkedRef = useRef(false);

  // ARKit/ARCore geospatial localization needs foreground location permission.
  useEffect(() => {
    void Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);

  // Once we have a pose, check VPS coverage at the current location (capability ≠ coverage).
  useEffect(() => {
    if (g.pose && !checkedRef.current) {
      checkedRef.current = true;
      g.checkVps(g.pose.latitude, g.pose.longitude)
        .then((r) => r && setVps(r))
        .catch(() => {});
    }
  }, [g]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoArView
        ref={g.ref}
        style={StyleSheet.absoluteFill}
        planeDetection="horizontal"
        trackingMode="geo"
        {...g.handlers}
      />
      <GeoHUD
        geoState={g.geoState}
        pose={g.pose}
        canPlace={g.canPlace}
        count={g.geoCount}
        vps={vps}
        onDrop={() => void g.dropAnchorHere()}
        onClear={g.clear}
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
});
