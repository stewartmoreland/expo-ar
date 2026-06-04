import type { TextStyle } from 'react-native';

// Design tokens for the AR HUD — a single source so App, the HUDs, the mode switch and
// the world-anchored labels stay cohesive and there are no cross-file magic offsets.
//
// Aesthetic: a precision instrument (think digital caliper) floating over a live camera.
// Dark translucent glass, one mint-teal accent, hairline borders, tabular figures, and
// tight uppercase micro-labels. Legibility over an arbitrary camera feed comes first.

export const NEON = '#5EEAD4';

export const colors = {
  accent: NEON,
  onAccent: '#04201A', // ink that reads on a neon fill
  text: '#F4FBF9',
  textDim: 'rgba(244,251,249,0.62)',
  hairline: 'rgba(244,251,249,0.16)',
  accentHairline: 'rgba(94,234,212,0.5)',
  gated: '#93A29E', // reticle/controls while tracking isn't ready
  scrim: 'rgba(4,9,10,0.55)',
} as const;

export const radii = { chip: 999, panel: 22, label: 11, reticle: 6 } as const;

// The only shared layout constants. Vertical positioning is always `inset + token`, so the
// top mode switch and the bottom action bar can never collide on any device.
export const LAYOUT = {
  topSlot: 52, // height reserved for the top mode switch
  edge: 20, // horizontal screen gutter
  gap: 14, // vertical breathing room between stacked chrome
} as const;

export const glowAccent = `0 0 12px ${NEON}`;

export const readoutText: TextStyle = {
  fontSize: 38,
  fontWeight: '800',
  color: colors.text,
  fontVariant: ['tabular-nums'],
  letterSpacing: 0.5,
};

export const subReadoutText: TextStyle = {
  fontSize: 13,
  fontWeight: '600',
  color: colors.textDim,
  fontVariant: ['tabular-nums'],
  letterSpacing: 0.3,
};

export const microLabel: TextStyle = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.6,
  textTransform: 'uppercase',
  color: colors.textDim,
};

export const labelChipText: TextStyle = {
  fontSize: 14,
  fontWeight: '700',
  color: colors.text,
  fontVariant: ['tabular-nums'],
  letterSpacing: 0.3,
};
