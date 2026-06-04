import type { GeoTrackingState, GeospatialPose } from 'expo-ar';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Caption, Glass, Reticle } from './controls';
import { formatAccuracy, formatGeoState } from './geospatial';
import { LAYOUT, colors, radii, readoutText, subReadoutText } from './theme';

// 2D HUD over the native AR view. Geo anchors are world-locked and rendered natively; this
// shows localization state + accuracy and gates the "Drop anchor" action on canPlace. Shares
// the same chrome as the other HUDs so the demos feel like one app.
export const GeoHUD = memo(function GeoHUD(props: {
  geoState: GeoTrackingState;
  pose: GeospatialPose | null;
  canPlace: boolean;
  count: number;
  vps: string;
  onDrop: () => void;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  const prompt = props.canPlace
    ? 'Tap “Drop anchor” to place at your location'
    : 'Point at buildings outdoors to localize';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        pointerEvents="box-none"
        style={[styles.top, { top: insets.top + LAYOUT.topSlot + LAYOUT.gap }]}>
        <Caption>{prompt}</Caption>
        <Glass style={styles.card} intensity={60}>
          <Text style={readoutText} selectable>
            {formatGeoState(props.geoState)}
          </Text>
          <Text style={subReadoutText} selectable>
            {`accuracy ${formatAccuracy(props.pose)} · VPS ${props.vps} · ${props.count} anchored`}
          </Text>
        </Glass>
      </View>

      <View style={styles.reticleWrap} pointerEvents="none">
        <Reticle ready={props.canPlace} />
      </View>

      <View style={[styles.bottom, { bottom: insets.bottom + LAYOUT.gap }]}>
        <ActionButton
          label="Drop anchor"
          variant="primary"
          onPress={props.onDrop}
          disabled={!props.canPlace}
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
