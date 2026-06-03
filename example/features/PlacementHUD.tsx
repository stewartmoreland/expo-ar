import { Pressable, StyleSheet, Text, View } from 'react-native';

const NEON = '#5EEAD4';

// 2D HUD over the native AR view. The placed cubes are world-anchored and rendered
// natively (so they stay locked in space); this only shows the count + controls.
export function PlacementHUD(props: {
  ready: boolean;
  count: number;
  onPlace: () => void;
  onRemoveLast: () => void;
  onClear: () => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={s.reticleWrap} pointerEvents="none">
        <View style={[s.reticle, !props.ready && s.gated]} />
      </View>

      <View style={s.top} pointerEvents="none">
        <View style={s.pill}>
          <Text style={s.pillTxt} selectable>
            {props.ready ? `${props.count} placed` : 'Move device to start…'}
          </Text>
        </View>
      </View>

      <View style={s.row}>
        <Pressable onPress={props.onRemoveLast} style={s.ghost}>
          <Text style={s.ghostTxt}>Remove last</Text>
        </Pressable>
        <Pressable
          onPress={props.onPlace}
          disabled={!props.ready}
          style={[s.primary, !props.ready && s.disabled]}>
          <Text style={s.primaryTxt}>Place</Text>
        </Pressable>
        <Pressable onPress={props.onClear} style={s.ghost}>
          <Text style={s.ghostTxt}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  reticleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: NEON,
    boxShadow: `0 0 8px ${NEON}`,
  },
  gated: { borderColor: '#9CA3AF', boxShadow: 'none' },
  top: { position: 'absolute', top: 72, left: 0, right: 0, alignItems: 'center' },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(94,234,212,0.4)',
  },
  pillTxt: { color: '#F9FAFB', fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  row: {
    position: 'absolute',
    bottom: 48,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primary: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999, backgroundColor: NEON },
  primaryTxt: { color: '#06281f', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  ghost: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ghostTxt: { color: '#E5E7EB', fontWeight: '600' },
});
