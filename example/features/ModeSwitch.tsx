import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass, haptic } from './controls';
import { LAYOUT, colors, radii } from './theme';

export type DemoMode = 'measure' | 'place';

const OPTIONS: { key: DemoMode; label: string }[] = [
  { key: 'measure', label: 'Measure' },
  { key: 'place', label: 'Place' },
];

// Top-anchored glass segmented control. Owns its own safe-area positioning; the HUDs
// start their top content below `insets.top + LAYOUT.topSlot`, so this never overlaps
// them and never collides with the bottom action bar (which uses the bottom inset).
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: DemoMode;
  onChange: (m: DemoMode) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + (LAYOUT.topSlot - 40) / 2 }]}>
      <Glass style={styles.track} intensity={70}>
        {OPTIONS.map((opt) => {
          const active = mode === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => {
                if (active) return;
                haptic.select();
                onChange(opt.key);
              }}
              style={[styles.item, active && styles.itemActive]}>
              <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  track: { flexDirection: 'row', padding: 4, borderRadius: radii.chip },
  item: { paddingHorizontal: 24, paddingVertical: 8, borderRadius: radii.chip },
  itemActive: { backgroundColor: colors.accent },
  label: { color: colors.text, fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
  labelActive: { color: colors.onAccent },
});
