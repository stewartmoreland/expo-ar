import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatArea, formatLength, type MeasureMode, type Unit } from './measurement';

const NEON = '#5EEAD4';

// 2D screen-space HUD drawn over the native AR view. Event-driven (updates on tap), so
// plain RN state is fine — no per-frame Skia needed. World-anchored lines are drawn
// natively; this only shows the readout + controls.
export function MeasureHUD(props: {
  mode: MeasureMode;
  unit: Unit;
  ready: boolean;
  distance: number | null;
  area: number | null;
  onAdd: () => void;
  onUndo: () => void;
  onClear: () => void;
  onCycleUnit: () => void;
  onToggleMode: () => void;
}) {
  const primary =
    props.mode === 'area'
      ? formatArea(props.area, props.unit)
      : formatLength(props.distance, props.unit);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Center reticle — neon when tracking is ready, grey while gated. */}
      <View style={s.reticleWrap} pointerEvents="none">
        <View style={[s.reticle, !props.ready && s.gated]} />
      </View>

      {/* Readout pill + unit/mode chips. */}
      <View style={s.top} pointerEvents="box-none">
        <View style={s.pill} pointerEvents="none">
          <Text style={s.pillTxt} selectable>
            {props.ready ? primary : 'Move device to start…'}
          </Text>
        </View>
        <View style={s.chips}>
          <Pressable style={s.chip} onPress={props.onToggleMode}>
            <Text style={s.chipTxt}>{props.mode}</Text>
          </Pressable>
          <Pressable style={s.chip} onPress={props.onCycleUnit}>
            <Text style={s.chipTxt}>{props.unit}</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.row}>
        <Pressable onPress={props.onUndo} style={s.ghost}>
          <Text style={s.ghostTxt}>Undo</Text>
        </Pressable>
        <Pressable
          onPress={props.onAdd}
          disabled={!props.ready}
          style={[s.primary, !props.ready && s.disabled]}>
          <Text style={s.primaryTxt}>Add point</Text>
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
    borderRadius: 11,
    borderWidth: 2,
    borderColor: NEON,
    boxShadow: `0 0 8px ${NEON}`,
  },
  gated: { borderColor: '#9CA3AF', boxShadow: 'none' },
  top: { position: 'absolute', top: 72, left: 0, right: 0, alignItems: 'center', gap: 10 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(94,234,212,0.4)',
  },
  pillTxt: { color: '#F9FAFB', fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  chipTxt: { color: '#E5E7EB', fontWeight: '600', textTransform: 'uppercase', fontSize: 12 },
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
