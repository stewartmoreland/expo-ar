import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, glowAccent, microLabel, radii } from './theme';

// Shared glass + control primitives so both HUDs and the mode switch share one look.
// Haptics fire on iOS only (Android's generic vibrate is coarse here); EXPO_OS is the
// Expo-recommended platform check.
const isIOS = process.env.EXPO_OS === 'ios';

export const haptic = {
  light: () => isIOS && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => isIOS && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  select: () => isIOS && Haptics.selectionAsync(),
  warn: () => isIOS && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};

/** Dark translucent glass surface. `blurMethod` is Android-only (ignored elsewhere). */
export function Glass({
  children,
  style,
  intensity = 55,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  return (
    <BlurView
      intensity={intensity}
      tint="systemThinMaterialDark"
      blurMethod="dimezisBlurViewSdk31Plus"
      style={[styles.glassBase, style]}>
      {children}
    </BlurView>
  );
}

type ButtonVariant = 'primary' | 'ghost';

/** Pill button with press feedback + haptics. Primary = solid neon; ghost = glass. */
export function ActionButton({
  label,
  onPress,
  variant = 'ghost',
  disabled,
  feedback = 'light',
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  feedback?: keyof typeof haptic;
}) {
  const handlePress = () => {
    if (disabled) return;
    haptic[feedback]();
    onPress();
  };

  const content = (
    <Text style={variant === 'primary' ? styles.primaryLabel : styles.ghostLabel}>{label}</Text>
  );

  if (variant === 'primary') {
    return (
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.primary,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}>
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => pressed && styles.pressed}>
      <Glass style={styles.ghost}>{content}</Glass>
    </Pressable>
  );
}

/** A small uppercase caption used above readouts and on toggle chips. */
export function Caption({ children }: { children: ReactNode }) {
  return <Text style={microLabel}>{children}</Text>;
}

/** Tappable glass chip (unit / mode toggles). */
export function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => pressed && styles.pressed}>
      <Glass style={styles.chip}>
        <Text style={styles.chipLabel}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

/** Centered crosshair reticle with a numbered "next point" badge. */
export function Reticle({ ready, nextIndex }: { ready: boolean; nextIndex?: number }) {
  const tint = ready ? colors.accent : colors.gated;
  return (
    <View style={styles.reticle} pointerEvents="none">
      <View style={[styles.reticleRing, { borderColor: tint }, ready && styles.reticleGlow]} />
      <View style={[styles.reticleDot, { backgroundColor: tint }]} />
      {/* four hairline ticks radiating from center */}
      <View style={[styles.tick, styles.tickT, { backgroundColor: tint }]} />
      <View style={[styles.tick, styles.tickB, { backgroundColor: tint }]} />
      <View style={[styles.tick, styles.tickL, { backgroundColor: tint }]} />
      <View style={[styles.tick, styles.tickR, { backgroundColor: tint }]} />
      {ready && nextIndex != null && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{nextIndex}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glassBase: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderCurve: 'continuous',
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },

  primary: {
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: radii.chip,
    backgroundColor: colors.accent,
    boxShadow: glowAccent,
    borderCurve: 'continuous',
  },
  primaryLabel: { color: colors.onAccent, fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  disabled: { opacity: 0.35, boxShadow: 'none' },

  ghost: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: radii.chip },
  ghostLabel: { color: colors.text, fontWeight: '600', fontSize: 15 },

  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.chip },
  chipLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  reticle: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  reticleRing: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  reticleGlow: { boxShadow: glowAccent },
  reticleDot: { width: 4, height: 4, borderRadius: 2 },
  tick: { position: 'absolute', backgroundColor: '#fff' },
  tickT: { width: 2, height: 8, top: 4 },
  tickB: { width: 2, height: 8, bottom: 4 },
  tickL: { width: 8, height: 2, left: 4 },
  tickR: { width: 8, height: 2, right: 4 },
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.onAccent,
    fontWeight: '800',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
