import {
  ExpoArView,
  getCapabilities,
  useArSession,
  type Capabilities,
  type TapEvent,
} from 'expo-ar';
import { useMemo } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

// Dev harness for the expo-ar core (GH #3 / #4). The milestone this exercises: a blank,
// tracking AR view with onReady + onTrackingStateChange firing, plus the raycast/anchor
// primitives. Run on a PHYSICAL device — ARKit/ARCore don't run in a simulator/emulator.
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

  return <ArHarness />;
}

function ArHarness() {
  const session = useArSession();

  // Tap → place an anchor at the hit point. addAnchor raycasts + creates the anchor and
  // fires onAnchorsChange, which the hook folds into `anchors`.
  const onTap = (e: { nativeEvent: TapEvent }) => {
    session.ref.current?.addAnchor(e.nativeEvent.x, e.nativeEvent.y).catch(() => {
      /* no surface at point — onError already fired */
    });
  };

  return (
    <View style={styles.container}>
      <ExpoArView
        ref={session.ref}
        style={StyleSheet.absoluteFill}
        planeDetection="both"
        depthEnabled
        debug
        onTap={onTap}
        {...session.handlers}
      />

      {/* 2D HUD drawn over the native AR view as normal RN elements. */}
      <SafeAreaView style={styles.hud} pointerEvents="box-none">
        <View style={styles.statusCard} pointerEvents="none">
          <Text style={styles.statusText}>tracking: {session.tracking}</Text>
          <Text style={styles.statusText}>ready: {session.ready ? 'yes' : 'no'}</Text>
          <Text style={styles.statusText}>anchors: {session.anchors.length}</Text>
          <Text style={styles.statusText}>
            depth/LiDAR: {session.caps?.depthOrLidarAvailable ? 'yes' : 'no'}
          </Text>
          {session.error ? <Text style={styles.errorText}>error: {session.error}</Text> : null}
          {!session.ready ? <Text style={styles.hint}>Move the device to start tracking…</Text> : null}
        </View>

        <View style={styles.controls}>
          <Pressable style={styles.button} onPress={session.reset}>
            <Text style={styles.buttonText}>Reset</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#111' },
  fallbackText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  hud: { flex: 1, justifyContent: 'space-between' },
  statusCard: { margin: 16, padding: 12, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  statusText: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },
  errorText: { color: '#ff8a80', fontSize: 14, marginTop: 4 },
  hint: { color: '#ffd54f', fontSize: 13, marginTop: 6 },
  controls: { margin: 16, alignItems: 'flex-start' },
  button: { backgroundColor: 'rgba(255,255,255,0.92)', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24 },
  buttonText: { color: '#000', fontSize: 15, fontWeight: '600' },
});
