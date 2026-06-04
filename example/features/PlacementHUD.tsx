import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Caption, Glass, Reticle } from './controls';
import { LAYOUT, colors, radii, readoutText, subReadoutText } from './theme';

// 2D HUD over the native AR view. Placed cubes are world-anchored and rendered natively;
// this shows the count + controls. Shares the same chrome as MeasureHUD (top card,
// centered reticle, bottom bar) so the two demos feel like one app.
export const PlacementHUD = memo(function PlacementHUD(props: {
  ready: boolean;
  count: number;
  onPlace: () => void;
  onRemoveLast: () => void;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  const prompt = !props.ready
    ? 'Move device to find a surface'
    : 'Tap a surface to place an object';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        pointerEvents="box-none"
        style={[styles.top, { top: insets.top + LAYOUT.topSlot + LAYOUT.gap }]}>
        <Caption>{prompt}</Caption>
        <Glass style={styles.card} intensity={60}>
          <Text style={readoutText} selectable>
            {props.ready ? `${props.count}` : '—'}
          </Text>
          <Text style={subReadoutText} selectable>
            {props.count === 1 ? 'object placed' : 'objects placed'}
          </Text>
        </Glass>
      </View>

      <View style={styles.reticleWrap} pointerEvents="none">
        <Reticle ready={props.ready} />
      </View>

      <View style={[styles.bottom, { bottom: insets.bottom + LAYOUT.gap }]}>
        <ActionButton label="Remove last" onPress={props.onRemoveLast} feedback="select" />
        <ActionButton
          label="Place"
          variant="primary"
          onPress={props.onPlace}
          disabled={!props.ready}
          feedback="medium"
        />
        <ActionButton label="Clear" onPress={props.onClear} feedback="warn" />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    left: LAYOUT.edge,
    right: LAYOUT.edge,
    gap: 10,
    alignItems: 'flex-start',
  },
  card: {
    borderRadius: radii.panel,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderColor: colors.accentHairline,
    alignItems: 'flex-start',
  },
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
