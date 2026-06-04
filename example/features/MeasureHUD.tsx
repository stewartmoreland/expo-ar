import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Caption, Chip, Glass, Reticle } from './controls';
import { formatArea, formatLength, type MeasureMode, type Unit } from './measurement';
import { LAYOUT, colors, radii, readoutText, subReadoutText } from './theme';

// 2D screen-space HUD over the native AR view. World-anchored lines + per-segment labels
// track natively/over the object; this is the guided "measuring tape" chrome: a top
// readout card with the step prompt, a centered reticle showing the next point number, and
// a bottom action bar. Memoized so the per-frame label updates (in MeasureDemo) don't
// re-render it — its props only change on tap or toggle.
export const MeasureHUD = memo(function MeasureHUD(props: {
  mode: MeasureMode;
  unit: Unit;
  ready: boolean;
  count: number;
  distance: number | null;
  perimeter: number | null;
  area: number | null;
  onAdd: () => void;
  onUndo: () => void;
  onClear: () => void;
  onCycleUnit: () => void;
  onToggleMode: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isArea = props.mode === 'area';

  const primary = isArea
    ? formatArea(props.area, props.unit)
    : formatLength(props.distance, props.unit);
  const secondary = isArea
    ? `perimeter ${formatLength(props.perimeter, props.unit)}`
    : `total ${formatLength(props.perimeter, props.unit)}`;

  const prompt = !props.ready
    ? 'Move device to find a surface'
    : props.count === 0
      ? 'Tap a surface to place point 1'
      : `Tap to place point ${props.count + 1}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Top readout card — below the mode switch slot. */}
      <View
        pointerEvents="box-none"
        style={[styles.top, { top: insets.top + LAYOUT.topSlot + LAYOUT.gap }]}>
        <Caption>{prompt}</Caption>
        <Glass style={styles.card} intensity={60}>
          <View style={styles.cardRow}>
            <View style={styles.readoutCol}>
              <Text style={readoutText} selectable>
                {props.ready ? primary : '—'}
              </Text>
              <Text style={subReadoutText} selectable>
                {props.ready ? `${secondary}  ·  ${props.count} pts` : 'Waiting for tracking…'}
              </Text>
            </View>
            <View style={styles.chips}>
              <Chip label={props.mode} onPress={props.onToggleMode} />
              <Chip label={props.unit} onPress={props.onCycleUnit} />
            </View>
          </View>
        </Glass>
      </View>

      {/* Centered reticle — always dead-center, shows the next point number. */}
      <View style={styles.reticleWrap} pointerEvents="none">
        <Reticle ready={props.ready} nextIndex={props.ready ? props.count + 1 : undefined} />
      </View>

      {/* Bottom action bar — above the home indicator. */}
      <View style={[styles.bottom, { bottom: insets.bottom + LAYOUT.gap }]}>
        <ActionButton label="Undo" onPress={props.onUndo} feedback="select" />
        <ActionButton
          label="Add point"
          variant="primary"
          onPress={props.onAdd}
          disabled={!props.ready}
          feedback="medium"
        />
        <ActionButton label="Clear" onPress={props.onClear} feedback="warn" />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  top: { position: 'absolute', left: LAYOUT.edge, right: LAYOUT.edge, gap: 10 },
  card: { borderRadius: radii.panel, padding: 16, borderColor: colors.accentHairline },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  readoutCol: { flexShrink: 1, gap: 4 },
  chips: { gap: 8 },
  reticleWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: LAYOUT.edge,
    right: LAYOUT.edge,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
