import { colors, radius, shadow, font } from '../lib/theme';

export const ui = {
  card: {
    background: colors.card, padding: 20, borderRadius: radius.lg,
    marginBottom: 12, border: `1px solid ${colors.border}`, boxShadow: shadow
  },
  cardFlat: {
    background: colors.card, padding: 20, borderRadius: radius.lg,
    marginBottom: 12, border: `1px solid ${colors.border}`
  },
  empty: {
    background: colors.card, padding: 32, borderRadius: radius.lg,
    textAlign: 'center', color: colors.textMuted, border: `1px solid ${colors.border}`
  },
  form: {
    background: colors.card, padding: 24, borderRadius: radius.lg,
    border: `1px solid ${colors.border}`, boxShadow: shadow,
    display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32
  },
  formTitle: { margin: 0, color: colors.primary, fontSize: 16, fontWeight: 600 },
  sectionTitle: { color: colors.primary, fontSize: 18, fontWeight: 600, margin: '0 0 16px' },
  sectionLabel: {
    color: colors.textMuted, fontSize: 12, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12
  },
  input: {
    padding: 12, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
    fontSize: 14, fontFamily: font, width: '100%', boxSizing: 'border-box'
  },
  textarea: {
    padding: 12, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
    fontSize: 14, resize: 'vertical', fontFamily: font, width: '100%', boxSizing: 'border-box'
  },
  btn: {
    padding: '12px 18px', borderRadius: radius.sm, background: colors.primary,
    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontFamily: font
  },
  btnAccent: {
    padding: '10px 16px', borderRadius: radius.sm, background: colors.accent,
    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontFamily: font
  },
  btnGhost: {
    padding: '10px 16px', borderRadius: radius.sm, background: colors.card,
    color: colors.error, border: `1px solid ${colors.border}`, fontWeight: 600, cursor: 'pointer', fontFamily: font
  },
  btnSecondary: {
    padding: '10px 16px', borderRadius: radius.sm, background: colors.background,
    color: colors.primary, border: `1px solid ${colors.border}`, cursor: 'pointer', fontFamily: font
  },
  row: { display: 'grid', gap: 12 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  error: { color: colors.error, marginBottom: 16, fontSize: 14 },
  hint: { fontSize: 12, color: colors.textMuted, margin: 0 },
  tag: { fontSize: 11, background: colors.background, padding: '4px 10px', borderRadius: radius.pill, color: colors.textMuted, textTransform: 'capitalize' },
  tagOpen: { background: '#D1FAE5', color: '#065F46' },
  tagClosed: { background: '#F3F4F6', color: colors.textMuted },
  statGrid: { display: 'grid', gap: 16 },
  statCard: {
    background: colors.card, borderRadius: radius.lg, padding: 20,
    border: `1px solid ${colors.border}`, boxShadow: shadow, textAlign: 'left', cursor: 'pointer'
  }
};

export const gridClass = {
  two: 'admin-grid-2',
  three: 'admin-grid-3',
  four: 'admin-grid-4',
  manage: 'admin-manage-grid',
  stat: 'admin-stat-grid'
};

export { colors, radius, shadow, font };
