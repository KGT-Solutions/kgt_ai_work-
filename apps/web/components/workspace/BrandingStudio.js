import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';
import { BASE_URL } from '../../lib/api';

// Bot Branding & Theme Studio. Shows the brand kit read from the company's
// website (logo, colours), lets the client correct it, and previews the three
// generated widget designs as live mock chats. "Apply this design" makes one
// live: the embeddable widget picks it up on its next page load.
//
// The mock chat paints a theme exactly the way the widget does
// (apps/api/public/widgets/tenant-chat-widget.js, applyTheme) — keep the two
// headerLook() mappings in step.

const SOURCE_LABEL = { website: 'From your website', manual: 'Edited by you', fallback: 'Default palette' };
const HEADER_LABEL = { minimal: 'Clean header', glass: 'Glass header', solid: 'Solid header', gradient: 'Gradient header' };
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function headerLook(t) {
  const look = baseHeaderLook(t);
  // As the widget: the server's contrast-checked muted colour (4.5:1 on every
  // header surface — themeGenerator.js mutedHeaderColor) when present.
  return HEX_RE.test(t.headerMutedColor || '') ? { ...look, muted: t.headerMutedColor } : look;
}

function baseHeaderLook(t) {
  if (t.headerStyle === 'solid' || t.headerStyle === 'gradient') {
    return {
      bg: t.headerStyle === 'gradient' ? `linear-gradient(135deg, ${t.primaryColor}, ${t.accentColor})` : t.primaryColor,
      text: t.onPrimaryColor, muted: rgba(t.onPrimaryColor, 0.75), border: 'transparent', chip: rgba(t.onPrimaryColor, 0.18)
    };
  }
  if (t.headerStyle === 'glass') {
    return { bg: rgba(t.primaryColor, 0.1), text: t.textColor, muted: rgba(t.textColor, 0.6), border: rgba(t.primaryColor, 0.18), chip: rgba(t.primaryColor, 0.12) };
  }
  return { bg: t.backgroundColor, text: t.textColor, muted: '#64748b', border: '#e2e8f0', chip: '#f1f5f9' };
}

const MAX_BOT_NAME = 40; // apps/api/src/services/branding.js MAX_BOT_NAME
// apps/api/src/services/shared/logoUpload.js — the server checks both again.
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_SOURCE_LABEL = { upload: 'Uploaded by you', link: 'From your website or a link' };

// ── Preview of a chosen-but-unsaved logo file. The server removes every logo's
// solid background on save (logoUpload.js); showing the raw file until then
// put its box on every card. This runs the same edge-plate removal in the
// browser — everything reachable from the image border through see-through
// pixels or pixels of the background colour becomes transparent, with a
// colour-to-alpha rim so edges stay smooth — on the local file (a same-origin
// blob, so its pixels are readable). The background colour is the border's
// own when the border is one solid colour (white, black, a brand colour),
// else white. It's a preview: the saved logo is the server's result.
// Resolves to an object URL (the caller revokes it).
const PREVIEW_MAX_EDGE = 512;
const PLATE_DISTANCE = 30;    // RGB distance from the background colour still counted as background (JPEG-tolerant)
const PLATE_TOLERANCE = 0.12; // as logoUpload.js KNOCKOUT_TOLERANCE

async function cleanPreview(file) {
  const rawUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = rawUrl;
    });
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    const d = frame.data;
    const n = w * h;
    // The background colour: the opaque border's mean when ≥75% of it is that one colour.
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
    const solid = border.filter((j) => d[j * 4 + 3] >= 200);
    let bg = [255, 255, 255];
    if (solid.length >= border.length * 0.8) {
      const mean = [0, 1, 2].map((c) => solid.reduce((s, j) => s + d[j * 4 + c], 0) / solid.length);
      const near = solid.filter((j) => Math.hypot(d[j * 4] - mean[0], d[j * 4 + 1] - mean[1], d[j * 4 + 2] - mean[2]) < 40).length;
      if (near >= solid.length * 0.75) bg = mean.map(Math.round);
    }
    const passable = (j) => d[j * 4 + 3] < 24 ||
      Math.hypot(d[j * 4] - bg[0], d[j * 4 + 1] - bg[1], d[j * 4 + 2] - bg[2]) <= PLATE_DISTANCE;
    const plate = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    let opaque = 0;
    const push = (j) => { if (!plate[j] && passable(j)) { plate[j] = 1; queue[tail++] = j; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const j = queue[head++];
      if (d[j * 4 + 3] >= 24) opaque += 1;
      const x = j % w;
      if (x > 0) push(j - 1);
      if (x < w - 1) push(j + 1);
      if (j >= w) push(j - w);
      if (j < n - w) push(j + w);
    }
    if (opaque / n < 0.03) return rawUrl; // no plate: show the file as it is
    for (let j = 0; j < n; j++) {
      // The plate and its 1px anti-aliased rim.
      const x = j % w;
      const onRim = plate[j] || (x > 0 && plate[j - 1]) || (x < w - 1 && plate[j + 1]) || (j >= w && plate[j - w]) || (j < n - w && plate[j + w]);
      if (!onRim) continue;
      const i = j * 4;
      // Colour-to-alpha against the background colour (headroom floored, as on the server).
      let dist = 0;
      for (let c = 0; c < 3; c++) {
        const p = d[i + c]; const q = bg[c];
        const v = p > q ? (p - q) / Math.max(255 - q, 96) : (q - p) / Math.max(q, 96);
        if (v > dist) dist = v;
      }
      const alpha = Math.min(1, Math.max(0, (dist - PLATE_TOLERANCE) / (0.6 - PLATE_TOLERANCE)));
      if (alpha > 0 && alpha < 1) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - bg[c]) / alpha + bg[c])));
      d[i + 3] = Math.round(d[i + 3] * alpha);
    }
    ctx.putImageData(frame, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return rawUrl;
    URL.revokeObjectURL(rawUrl);
    return URL.createObjectURL(blob);
  } catch {
    return rawUrl; // unreadable here: the server still decides on save
  }
}

// Whether a design's header is light (its logo then sits straight on it).
function headerIsLight(theme) {
  const hex = theme.headerStyle === 'solid' || theme.headerStyle === 'gradient' ? theme.primaryColor : theme.backgroundColor;
  if (!HEX_RE.test(hex || '')) return true;
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.4;
}

// How an unsaved preview sits on a design (it hasn't been analysed yet):
// straight on every header, as the saved logo will — multiply-blended on a
// light one in case some of its background survived the preview cleanup.
const PENDING_ON_LIGHT = { mode: 'plain', background: null, blend: true, ring: false, tint: null, variant: null };
const PENDING_ON_COLOUR = { mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: null };

// An uploaded logo is served by the API at a relative path; a linked one is a full URL.
function resolveLogo(url) {
  return typeof url === 'string' && url.startsWith('/api/v1/public/brand-assets/') ? `${BASE_URL}${url}` : url || null;
}
const LOGO_BACKGROUND_LABEL = { light: 'a light', dark: 'a dark', color: 'a coloured', complex: 'a patterned' };

// What the server's logo analysis found, and what each design does about it.
function describeLogo(a, cleaned) {
  const lead = cleaned ? 'We removed its background, so only the logo artwork shows. ' : '';
  if (!a) return 'Couldn’t be analysed (for example an .ico file), so its background couldn’t be removed. Upload a PNG for a clean, see-through logo.';
  if (a.background !== 'transparent') {
    return `Its ${LOGO_BACKGROUND_LABEL[a.background] || 'patterned'} background couldn’t be separated from the artwork, so it may show as a box on coloured headers. A transparent PNG looks best.`;
  }
  const flip = a.tone === 'light' ? 'dark' : 'light';
  return lead + (a.monochrome
    ? `Transparent, single-colour: shown as-is where it contrasts, and recoloured ${flip === 'light' ? 'white' : 'dark'} on headers where it wouldn’t.`
    : `Transparent, multicolour: shown as-is where it contrasts; on ${flip === 'light' ? 'dark' : 'light'} headers its lettering switches to a ${flip} version.`);
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function formatDate(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// The badge a design seats the logo in (logoBadge, decided server-side from
// the logo's own pixels — themeGenerator.js logoBadgeFor), so only the artwork
// shows, never a pasted-on rectangle (a white box is normally removed from the
// image itself, server-side):
//   plain — straight on the header; tint 'light'/'dark' recolours a
//           single-colour mark to the header's ink; blend (multiply) melts a
//           remaining white box into a light header
//   pill  — a padded, rounded chip on a contrasting plate (blend melts a white
//           image box into a white chip)
//   tile  — a coloured/dark app-icon logo, edge to edge, rounded
// ring adds a hairline (in the header's text colour) when a plate matches the
// header. These are the widget's exact rules (tenant-chat-widget.js, the
// `-brand .badge` CSS and renderBrand) at the widget's 30px slot, scaled by
// `size` — keep the two in step. The initial stands in when there's no logo
// or it fails to load.
const DEFAULT_BADGE = { mode: 'plain', background: null, blend: true, ring: false, tint: null, variant: null }; // themeGenerator DEFAULT_LOGO_BADGE
const TINT_FILTER = { light: 'brightness(0) invert(1)', dark: 'brightness(0)' };

function BrandMark({ logoUrl, name, badge = DEFAULT_BADGE, chip = '#f1f5f9', ink = '#0f172a', size = 30 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [logoUrl]);
  if (logoUrl && !failed) {
    const k = size / 30; // the widget's slot is 30px
    const mode = badge?.mode === 'plain' || badge?.mode === 'tile' ? badge.mode : 'pill';
    const tint = mode === 'plain' && TINT_FILTER[badge?.tint] ? badge.tint : null;
    const plate = mode === 'plain' ? 'transparent' : HEX_RE.test(badge?.background || '') ? badge.background : '#ffffff';
    const shadows = [];
    if (badge?.ring && mode !== 'plain' && HEX_RE.test(ink)) shadows.push(`0 0 0 1px ${rgba(ink, 0.22)}`);
    if (mode === 'pill') shadows.push('0 1px 2px rgba(15,23,42,.12)');
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', flexShrink: 0, minWidth: 0,
        height: mode === 'plain' ? 28 * k : size,
        maxWidth: (mode === 'plain' ? 120 : 112) * k,
        overflow: 'hidden',
        borderRadius: mode === 'plain' ? 0 : mode === 'pill' ? 10 * k : 9 * k,
        padding: mode === 'pill' ? `${4 * k}px ${10 * k}px` : mode === 'tile' ? 2 * k : `${2 * k}px 0`,
        background: plate,
        boxShadow: shadows.length ? shadows.join(',') : 'none'
      }}>
        <img src={logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} draggable={false}
          style={{
            display: 'block', height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', objectPosition: 'center',
            userSelect: 'none',
            mixBlendMode: badge?.blend && !tint ? 'multiply' : 'normal',
            // As the widget: lift near-white to pure white so multiply erases all of it.
            filter: tint ? TINT_FILTER[tint] : badge?.blend ? 'brightness(1.05)' : 'none',
            opacity: tint === 'dark' ? 0.86 : 1
          }} />
      </span>
    );
  }
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: chip, color: ink, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.48, fontWeight: 700
    }}>
      {String(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function Swatch({ color, label }) {
  return (
    <span title={`${label} · ${color}`} className="inline-block h-5 w-5 rounded-full ring-1 ring-white/15"
      style={{ backgroundColor: color }} />
  );
}

function MockBubble({ theme, side, children }) {
  const user = side === 'user';
  return (
    <div style={{
      alignSelf: user ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '7px 10px',
      borderRadius: theme.borderRadius, fontSize: 12, lineHeight: 1.4,
      background: user ? theme.primaryColor : theme.botBubbleColor,
      color: user ? theme.onPrimaryColor : theme.textColor
    }}>
      {children}
    </div>
  );
}

function ThemeCard({ theme, companyName, title, logoUrl, badge = theme.logoBadge, live, applying, disabled, onApply }) {
  const head = headerLook(theme);
  return (
    <Card className={cx('flex flex-col overflow-hidden', live && 'ring-2 ring-emerald-400/50')}>
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-fg">{theme.themeName}</h3>
          <p className="mt-0.5 text-[12px] leading-snug text-fg-3">{theme.description}</p>
        </div>
        {live && <Badge tone="success" dot>Live</Badge>}
      </div>

      {/* Mock widget, painted with this design */}
      <div className="px-4">
        <div style={{
          background: theme.backgroundColor, fontFamily: theme.fontFamily, color: theme.textColor,
          borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(15,23,42,.10)', boxShadow: '0 10px 28px rgba(6,10,26,.25)'
        }}>
          <div style={{
            background: head.bg, color: head.text, borderBottom: `1px solid ${head.border}`,
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px'
          }}>
            <BrandMark logoUrl={logoUrl} name={companyName} badge={badge} chip={head.chip} ink={head.text} />
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <span style={{ marginLeft: 'auto', color: head.muted, fontSize: 16, lineHeight: 1 }}>×</span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 168 }}>
            <MockBubble theme={theme} side="bot">Hi there! How can I help you today?</MockBubble>
            <MockBubble theme={theme} side="user">Do you ship internationally?</MockBubble>
            <MockBubble theme={theme} side="bot">Yes, we ship to most countries. Delivery takes 5–7 days.</MockBubble>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid rgba(15,23,42,.08)' }}>
            <div style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#94a3b8', background: '#fff' }}>
              Type your message…
            </div>
            <div style={{ background: theme.primaryColor, color: theme.onPrimaryColor, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>
              Send
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Swatch color={theme.primaryColor} label="Primary" />
          <Swatch color={theme.accentColor} label="Accent" />
          <Swatch color={theme.botBubbleColor} label="Bot bubble" />
          <Swatch color={theme.backgroundColor} label="Background" />
          <span className="ml-2 truncate text-[11.5px] text-fg-3">
            {theme.borderRadius}px corners · {HEADER_LABEL[theme.headerStyle] || theme.headerStyle}
          </span>
        </div>
        <Button variant={live ? 'secondary' : 'primary'} className="w-full" onClick={onApply}
          loading={applying} disabled={live || disabled}>
          {live ? 'Applied' : applying ? 'Applying…' : 'Apply this design'}
        </Button>
      </div>
    </Card>
  );
}

export default function BrandingStudio({ ws, companyName }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanUrl, setScanUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [logoInput, setLogoInput] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [botNameInput, setBotNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  // A chosen-but-unsaved logo file and its local preview (an object URL);
  // it's uploaded by "Save & regenerate".
  const [pendingLogo, setPendingLogo] = useState(null);
  const [removingLogo, setRemovingLogo] = useState(false);
  const fileRef = useRef(null);

  const clearPendingLogo = useCallback(() => {
    setPendingLogo((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
  }, []);
  useEffect(() => () => { if (pendingLogo) URL.revokeObjectURL(pendingLogo.previewUrl); }, [pendingLogo]);

  const adopt = useCallback((view) => {
    setData(view);
    setBotNameInput(view.botName || '');
    // The URL field holds a linked logo only; an uploaded one has no URL to edit.
    setLogoInput(view.logoSource === 'link' ? view.linkedLogoUrl || '' : '');
    setColorInput(view.primaryColor || '');
    setScanUrl((prev) => prev || view.sourceUrl || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      adopt(await ws.getBranding());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast, adopt]);

  useEffect(() => { load(); }, [load]);

  const apply = async (themeId) => {
    setApplyingId(themeId ?? 'classic');
    try {
      adopt(await ws.selectTheme(themeId));
      toast.success(themeId ? 'Design applied. Your website widget shows it on the next page load.' : 'Back to the classic widget look.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setApplyingId(null);
    }
  };

  const rescan = async (e) => {
    e.preventDefault();
    if (!scanUrl.trim()) return;
    setScanning(true);
    try {
      const view = await ws.scanBranding(scanUrl.trim());
      adopt(view);
      const { logo, colors } = view.found || {};
      const keptUpload = logo && view.logoSource === 'upload';
      if (logo || colors) {
        toast.success(`Found ${[logo && 'your logo', colors && 'your brand colours'].filter(Boolean).join(' and ')}. Designs regenerated.` +
          (keptUpload ? ' Your uploaded logo is kept — remove it to use the one from your website.' : ''));
      }
      else toast.error('We couldn’t read a logo or colours from that page. Add them below instead.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setScanning(false);
    }
  };

  const saveKit = async (e) => {
    e.preventDefault();
    const color = colorInput.trim();
    if (color && !HEX_RE.test(color)) {
      toast.error('Enter the brand colour as a hex value, like #1a73e8.');
      return;
    }
    setSaving(true);
    try {
      let view = data;
      if (pendingLogo) {
        // The upload replaces any linked logo, so the URL field is not sent with it.
        view = await ws.uploadBrandLogo(pendingLogo.file);
        clearPendingLogo();
        adopt(view);
      }
      const changes = { primaryColor: color };
      const linkedBefore = data.logoSource === 'link' ? data.linkedLogoUrl || '' : '';
      // Only a URL the client actually edited is sent: an unchanged (or empty,
      // for an uploaded logo) field must not wipe the logo.
      if (!pendingLogo && logoInput.trim() !== linkedBefore) changes.logoUrl = logoInput.trim();
      if (pendingLogo && color === (view.primaryColor || '')) {
        toast.success('Logo uploaded. The three designs were regenerated around it.');
      } else {
        adopt(await ws.updateBranding(changes));
        toast.success(pendingLogo ? 'Logo uploaded and brand kit saved. The designs were regenerated.' : 'Brand kit saved. The three designs were regenerated from it.');
      }
    } catch (err) {
      toast.error(err.message);
      await load(); // an upload may have succeeded before a later step failed
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error('Choose a PNG, JPEG or WebP image.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(`That image is ${(file.size / (1024 * 1024)).toFixed(1)}MB — logos are limited to 2MB.`);
      e.target.value = '';
      return;
    }
    const input = e.target;
    cleanPreview(file).then((previewUrl) => {
      // Ignore a slow preview for a file the user has since replaced or cancelled.
      if (input.files?.[0] !== file) { URL.revokeObjectURL(previewUrl); return; }
      setPendingLogo((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl };
      });
    });
  };

  // "Remove": a pending file is just dropped; a saved logo (uploaded or
  // linked) is removed from the widget, which falls back to the initial.
  const removeLogo = async () => {
    if (pendingLogo) {
      clearPendingLogo();
      return;
    }
    setRemovingLogo(true);
    try {
      adopt(await ws.removeBrandLogo());
      toast.success('Logo removed. Your widget shows your company’s initial instead.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRemovingLogo(false);
    }
  };

  // Saves only the name: the logo and colour fields keep any unsaved edits.
  const saveName = async (e) => {
    e.preventDefault();
    const nextName = botNameInput.trim();
    setSavingName(true);
    try {
      const view = await ws.updateBranding({ botName: nextName });
      setData(view);
      setBotNameInput(view.botName || '');
      toast.success(nextName ? 'Bot name saved. Your website widget shows it on the next page load.' : 'Bot name cleared — the widget uses its default title.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingName(false);
    }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading your brand kit…</Card>;
  }
  if (!data) {
    return (
      <Card className="p-6 text-sm text-fg-3">
        Couldn’t load your brand kit. <button type="button" onClick={load} className="font-medium text-fg underline">Try again</button>
      </Card>
    );
  }

  const name = companyName || data.siteName || 'Your company';
  const liveId = data.selectedThemeId;
  const busy = applyingId !== null;
  const sourceLine = data.source === 'website' && data.scannedAt
    ? `Read from ${hostOf(data.sourceUrl) || 'your website'} on ${formatDate(data.scannedAt)}`
    : data.source === 'manual' ? 'Set by you' : 'No website scanned yet — the designs use a neutral palette';

  const previewTitle = botNameInput.trim() || name; // the previews follow the name as it's typed
  const nameUnchanged = botNameInput.trim() === (data.botName || '');

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader title="Bot identity" description="The name visitors see at the top of your chat widget, with or without a design applied." />
        <form onSubmit={saveName} className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr),auto] sm:items-end sm:p-6">
          <Field label="Bot display name" htmlFor="bot-name"
            hint={`Up to ${MAX_BOT_NAME} characters — e.g. “Support Assistant”, “Sales Expert” or “Aria from ${name}”. Leave empty for the default title.`}>
            <Input id="bot-name" maxLength={MAX_BOT_NAME} placeholder="Support Assistant" value={botNameInput}
              onChange={(e) => setBotNameInput(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={savingName} disabled={savingName || nameUnchanged}>
            {savingName ? 'Saving…' : 'Save name'}
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Brand kit"
          description={sourceLine}
          action={<Badge tone={data.source === 'fallback' ? 'neutral' : 'success'}>{SOURCE_LABEL[data.source] || data.source}</Badge>}
        />
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-[13px] font-semibold text-fg">Logo</h4>
              {pendingLogo ? <Badge tone="warning">Not saved yet</Badge>
                : data.logoSource && <Badge tone="neutral">{LOGO_SOURCE_LABEL[data.logoSource]}</Badge>}
            </div>
            {pendingLogo || data.logoUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* On a transparency checkerboard, not a chip: a removed background is visibly gone. */}
                <span title="Checkered = see-through" className="inline-flex items-center rounded-lg p-2"
                  style={{ backgroundColor: '#ffffff', backgroundImage: 'conic-gradient(#e2e8f0 25%, transparent 0 50%, #e2e8f0 0 75%, transparent 0)', backgroundSize: '12px 12px' }}>
                  <BrandMark logoUrl={pendingLogo ? pendingLogo.previewUrl : resolveLogo(data.logoUrl)} name={name}
                    badge={{ mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: null }} size={36} />
                </span>
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-fg-3">
                  {pendingLogo
                    ? `${pendingLogo.file.name} — click “Save & regenerate” below to use it.`
                    : describeLogo(data.logoAppearance, data.logoCleaned)}
                </span>
                <Button size="sm" variant={pendingLogo ? 'ghost' : 'danger'} onClick={removeLogo}
                  loading={removingLogo} disabled={removingLogo || saving}>
                  {pendingLogo ? 'Cancel' : 'Remove logo'}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">No logo yet — the widget shows your company’s initial. Upload one, rescan your website or paste a logo URL below.</p>
            )}

            <div className="mt-4">
              <label htmlFor="brand-logo-file" className="text-[12.5px] font-medium text-fg-2">Upload your own logo</label>
              <input id="brand-logo-file" ref={fileRef} type="file" accept="image/png, image/jpeg, image/webp" onChange={pickLogo}
                disabled={saving}
                className="mt-1.5 block w-full text-[12.5px] text-fg-3 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-fg hover:file:bg-white/[0.12]" />
              <p className="mt-1 text-[11.5px] text-fg-3">PNG, JPEG or WebP, up to 2MB. A square or wide logo with a transparent background looks best.</p>
            </div>

            <h4 className="mt-5 text-[13px] font-semibold text-fg">Brand colours</h4>
            {data.colors.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.colors.map((c) => (
                  <span key={c} className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] py-1 pl-1 pr-3 text-[12px] text-fg-2">
                    <span className="h-5 w-5 rounded-full ring-1 ring-white/15" style={{ backgroundColor: c }} />
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
                No brand colours found yet. Rescan your website or set your colour below — until then the designs use a neutral palette.
              </p>
            )}
            {data.fontHints.length > 0 && (
              <p className="mt-3 text-[12px] text-fg-3">Font on your site: <span className="text-fg-2">{data.fontHints.join(', ')}</span></p>
            )}
          </div>

          <form onSubmit={rescan} className="flex flex-col gap-3">
            <Field label="Your website" htmlFor="brand-url" hint="We read the logo and colours from this page only — nothing else is crawled.">
              <Input id="brand-url" type="url" placeholder="https://www.example.com" value={scanUrl}
                onChange={(e) => setScanUrl(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" variant="secondary" loading={scanning} disabled={scanning || !scanUrl.trim()}>
                {scanning ? 'Scanning…' : 'Rescan website'}
              </Button>
            </div>
          </form>
        </div>

        <form onSubmit={saveKit} className="grid gap-4 border-t border-white/[0.06] p-5 sm:grid-cols-[minmax(0,1fr),220px,auto] sm:items-end sm:p-6">
          <Field label="Logo image URL" htmlFor="brand-logo"
            hint={data.logoSource === 'upload' && !pendingLogo
              ? 'Using your uploaded logo. Paste a URL here to replace it.'
              : 'PNG, SVG or JPG on https. Leave empty to show your initial.'}>
            <Input id="brand-logo" type="url" placeholder="https://www.example.com/logo.png" value={logoInput}
              onChange={(e) => setLogoInput(e.target.value)} disabled={!!pendingLogo} />
          </Field>
          <Field label="Brand colour" htmlFor="brand-color">
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick brand colour" value={HEX_RE.test(colorInput) ? colorInput : '#4f46e5'}
                onChange={(e) => setColorInput(e.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5" />
              <Input id="brand-color" placeholder="#1a73e8" value={colorInput} onChange={(e) => setColorInput(e.target.value)} />
            </div>
          </Field>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            {saving ? 'Saving…' : 'Save & regenerate'}
          </Button>
        </form>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">Choose your widget design</h3>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              {liveId ? 'The highlighted design is live on your website.' : 'Your widget is using the classic look. Apply a design to brand it.'}
            </p>
          </div>
          {liveId && (
            <Button variant="secondary" onClick={() => apply(null)} loading={applyingId === 'classic'} disabled={busy}>
              Use the classic look
            </Button>
          )}
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {data.themes.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} companyName={name} title={previewTitle}
              // A design may show the logo's reversed variant (server: branding.js logoUrlFor).
              // An unsaved file is previewed cleaned in the browser (cleanPreview) and
              // seated by header lightness, since the server hasn't analysed it yet.
              logoUrl={pendingLogo ? pendingLogo.previewUrl : resolveLogo(
                theme.logoBadge?.variant === 'reversed' && data.logoUrlReversed ? data.logoUrlReversed : data.logoUrl)}
              badge={pendingLogo ? (headerIsLight(theme) ? PENDING_ON_LIGHT : PENDING_ON_COLOUR) : theme.logoBadge}
              live={liveId === theme.id} applying={applyingId === theme.id} disabled={busy}
              onApply={() => apply(theme.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
