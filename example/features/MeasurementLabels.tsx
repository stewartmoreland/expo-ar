import { type Anchor, type ProjectedPoint } from 'expo-ar';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { Glass } from './controls';
import { formatLength, type Unit } from './measurement';
import { colors, labelChipText, radii } from './theme';

// 2D length labels pinned to each segment ON the real object. The native side projects
// every anchor to screen space each frame (the `projected` map); we drop one glass chip at
// the midpoint of each segment so it tracks in 3D as the device moves. All geometry and
// unit formatting stay in JS (the tested pure-math layer) — native only projects points.
export function MeasurementLabels({
  anchors,
  segments,
  projected,
  unit,
}: {
  anchors: Anchor[];
  segments: number[];
  projected: Record<string, ProjectedPoint>;
  unit: Unit;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {segments.map((meters, i) => {
        const aId = anchors[i]?.id;
        const bId = anchors[i + 1]?.id;
        if (!aId || !bId) return null;
        const a = projected[aId];
        const b = projected[bId];
        // Hide a label whose endpoint isn't projected yet or has gone behind the camera.
        if (!a || !b || !a.inFront || !b.inFront) return null;
        return (
          <SegmentLabel
            key={`${aId}-${bId}`}
            x={(a.x + b.x) / 2}
            y={(a.y + b.y) / 2}
            text={formatLength(meters, unit)}
          />
        );
      })}
    </View>
  );
}

function SegmentLabel({ x, y, text }: { x: number; y: number; text: string }) {
  // onLayout gives the chip's measured size so we can center it on the midpoint. A fade-in
  // runs once on mount (stable key), not on every per-frame reposition.
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Lazy useState keeps one stable Animated.Value without reading a ref during render.
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [opacity]);

  return (
    <Animated.View
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      pointerEvents="none"
      style={[styles.anchor, { left: x - size.w / 2, top: y - size.h / 2, opacity }]}>
      <Glass style={styles.chip} intensity={65}>
        <Text style={labelChipText}>{text}</Text>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute' },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radii.label,
    borderColor: colors.accentHairline,
    borderWidth: 1,
  },
});
