/** Emerald Fresh tokens — aligned with design-system.md */
export const colors = {
  primary: '#059669',
  primaryLight: '#34d39a',
  primaryInk: '#06231a',
  background: '#effdf5',
  accent: '#059669',
  accentInk: '#059669',
  accentSoft: '#d3f6e3',
  warning: '#8a6a2f',
  warningSoft: '#f4ead1',
  error: '#c2503f',
  text: '#06231a',
  textBody: '#2f5c4a',
  textMuted: '#7ba392',
  label: '#7ba392',
  border: '#cbe8db',
  card: '#ffffff',
  chevron: '#9dc4b3',
  track: '#e2f2ea'
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 10, md: 16, lg: 18, pill: 999 };

export const shadow = {
  card: {
    shadowColor: '#063c28',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  soft: {
    shadowColor: '#063c28',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  }
};

export const typography = {
  title: { fontSize: 26, fontWeight: '800', color: colors.primaryInk, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  body: { fontSize: 14, color: colors.textBody, lineHeight: 20 },
  caption: { fontSize: 11, color: colors.textMuted }
};

export const layout = {
  /** Change this one value to control overall app width on desktop/web */
  desktopMaxWidth: 430,
  screen: { flex: 1, backgroundColor: colors.transparent },
  screenPad: { padding: spacing.lg, paddingBottom: spacing.xl },
  shell: { width: '100%', paddingHorizontal: 20 },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill
  },
  locationText: { fontSize: 12, color: colors.textBody, fontWeight: '600' }
};
