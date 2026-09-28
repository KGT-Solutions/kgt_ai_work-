// Chart series colors, in fixed order. Validated with the dataviz palette
// checker on the dark chart surface #0E1117: lightness band, chroma floor,
// colorblind separation (worst ΔE 13.3), normal-vision separation (22.2) and
// contrast all pass. Brighter cyan/violet are UI accents only — not data.
export const SERIES = {
  cyan: '#0EA5C6',
  violet: '#9061F9'
};

// Recessive chart chrome (text wears text tokens, never series colors).
export const CHART_INK = {
  grid: 'rgba(255,255,255,0.06)',
  axis: '#6B7385',
  label: '#A0A8B8'
};
