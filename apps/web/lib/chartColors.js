// Chart series colors, in fixed order: the KGT Solutions logo's blue and
// green, stepped into the chart band. Validated with the dataviz palette
// checker on the dark chart surface #0E1117: lightness band, chroma floor,
// colorblind separation (worst ΔE 25.3), normal-vision separation (27.2) and
// contrast all pass. The brighter brand-*/green-* tints are UI accents only — not data.
export const SERIES = {
  blue: '#3D84EC',
  green: '#1FA855'
};

// Recessive chart chrome (text wears text tokens, never series colors).
export const CHART_INK = {
  grid: 'rgba(255,255,255,0.06)',
  axis: '#6B7385',
  label: '#A0A8B8'
};
