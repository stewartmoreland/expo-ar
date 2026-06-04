import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { type Detection } from 'expo-ar';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionButton, Caption, Glass } from './controls';
import { type Size, bboxToRects, formatMeters } from './detection';
import { LAYOUT, NEON, colors, labelChipText, radii, readoutText, subReadoutText } from './theme';

// 2D HUD over the native AR view. Detection boxes move with every detection batch (~detectionFps),
// so the boxes are drawn on a Skia canvas (re-rendering RN <View>s would jank); the labels are RN
// chips pinned to each box. World-anchored content placed via "Place" is rendered NATIVELY, not here.
export const DetectionHUD = memo(function DetectionHUD(props: {
  ready: boolean;
  detections: Detection[];
  detector: string;
  size: Size;
  lastMeasure: number | null;
  onPlace: () => void;
  onMeasure: () => void;
  onClear: () => void;
}) {
  const insets = useSafeAreaInsets();
  const rects = bboxToRects(props.detections, props.size);
  const prompt = !props.ready
    ? 'Move device to start tracking'
    : props.detections.length === 0
      ? 'Point at an object to detect it'
      : 'Place a model on, or measure, the top detection';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Skia overlay: neon stroked box per detection. */}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {rects.map((r) => (
          <RoundedRect
            key={r.id}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            r={8}
            color={NEON}
            style="stroke"
            strokeWidth={2.5}
          />
        ))}
      </Canvas>

      {/* RN label chips pinned to each box (update at detection cadence, not per frame). */}
      {rects.map((r) => (
        <View key={r.id} style={[styles.tag, { left: r.x, top: Math.max(r.y - 26, 0) }]}>
          <Text style={labelChipText}>{r.label}</Text>
        </View>
      ))}

      <View
        pointerEvents="box-none"
        style={[styles.top, { top: insets.top + LAYOUT.topSlot + LAYOUT.gap }]}>
        <Caption>{prompt}</Caption>
        <Glass style={styles.card} intensity={60}>
          <Text style={readoutText} selectable>
            {props.ready ? `${props.detections.length}` : '—'}
          </Text>
          <Text style={subReadoutText} selectable>
            {props.detections.length === 1 ? 'object detected' : 'objects detected'}
          </Text>
          <Text style={[subReadoutText, styles.measure]} selectable>
            width {formatMeters(props.lastMeasure)}
          </Text>
          {props.detector !== '' && (
            <Text style={[subReadoutText, styles.detector]} selectable>
              detector: {props.detector}
            </Text>
          )}
        </Glass>
      </View>

      <View style={[styles.bottom, { bottom: insets.bottom + LAYOUT.gap }]}>
        <ActionButton label="Measure" onPress={props.onMeasure} feedback="select" />
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
  measure: { marginTop: 4, color: colors.accent },
  detector: { marginTop: 2, color: colors.textDim },
  tag: {
    position: 'absolute',
    backgroundColor: colors.scrim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.label,
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
