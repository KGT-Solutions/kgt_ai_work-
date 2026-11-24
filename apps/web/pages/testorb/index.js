import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import OrbShell from '../../components/shell/OrbShell';
import { Banner, Button, Pill, IconPlay } from '../../components/orb';
import { TestChatCard, KnowledgeReadinessPanel, SourcesCard } from '../../components/orb/testorb';
import { clientWorkspace } from '../../lib/api';
import { categoryLabel } from '../../lib/documentCategories';

// Test Orb page. Owns the per-bot transcripts and the chat/FAQ/readiness/
// documents API calls. The readiness card and the sources card are both wired
// to the real workspace API.

// Starter FAQ keys (ws.getFaqs) + generic fallbacks per bot and language.
const FAQ_KEY = { support: 'supportFaqs', sales: 'salesFaqs' };
const GENERIC = {
  support: { en: ['How do I get started?', 'What is your refund policy?'], hi: ['मैं कैसे शुरू करूँ?', 'आपकी रिफ़ंड नीति क्या है?'] },
  sales: { en: ['Why should we choose you?', 'How does your pricing work?'], hi: ['हम आपको क्यों चुनें?', 'आपकी कीमत कैसे तय होती है?'] }
};

// Readiness score → status pill. ≥80 ready (tint), else needs attention (yellow).
const readinessStatus = (score) =>
  score >= 80 ? { label: 'Ready', tone: 'tint' }
    : score >= 50 ? { label: 'Moderate', tone: 'yellow' }
      : { label: 'Not ready', tone: 'yellow' };
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
// Category → Orb pill tone (same mapping as the Knowledge page).
const CAT_TONE = { CORE_OVERVIEW: 'neutral', FAQ: 'blue', CUSTOM_POLICY: 'yellow' };

export default function TestOrbPage() {
  const ws = useMemo(() => clientWorkspace(), []);
  const qc = useQueryClient();
  const [bot, setBot] = useState('support'); // which bot the chat targets
  const [lang, setLang] = useState('en');
  const [threads, setThreads] = useState({ support: [], sales: [] });
  const [sessions, setSessions] = useState({});
  const [pending, setPending] = useState({ support: false, sales: false });
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null); // base64 data URL staged for the next send
  const [imgError, setImgError] = useState('');

  // Starter questions written from the tenant's docs; poll while generating.
  const { data: faqs } = useQuery({
    queryKey: ['orb-faqs'],
    queryFn: () => ws.getFaqs(),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 4000 : false)
  });
  const regen = useMutation({
    mutationFn: () => ws.regenerateFaqs(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orb-faqs'] })
  });
  const generating = faqs?.status === 'pending';
  const hiList = faqs?.[`${FAQ_KEY[bot]}Hi`] || [];
  const faqList = (lang === 'hi' && hiList.length ? hiList : faqs?.[FAQ_KEY[bot]]) || [];
  const suggested = faqList.length ? faqList : GENERIC[bot][lang];

  // Knowledge readiness for the selected bot (same `bot` state as the chat).
  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ['orb-readiness'],
    queryFn: () => ws.getReadiness(),
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false)
  });
  const report = readiness?.report || null;
  const botReport = report?.bots?.[bot] || null;
  const readinessScore = botReport?.score ?? 0;
  // What to add: the to-do list to fully train this bot, falling back to its gaps.
  const toAdd = botReport ? (botReport.requirements?.length ? botReport.requirements : (botReport.criticalGaps || [])) : [];
  const readinessNote =
    readinessLoading ? 'Checking readiness…'
      : !botReport ? 'Run a training check to see how ready the bot is.'
        : readinessScore >= 80 ? `Ready to install. Orb has ${(botReport.characters || 0).toLocaleString()} characters for this bot.`
          : `Below Ready: ${toAdd.length} topic${toAdd.length === 1 ? '' : 's'} to add. Orb has ${(botReport.characters || 0).toLocaleString()} characters for this bot.`;
  const readinessCheckedAt =
    readiness?.running ? 'Checking now…'
      : report?.auditedAt ? `Checked ${fmtDateTime(report.auditedAt)}${readiness?.stale ? ' · documents changed since' : ''}`
        : 'Not checked yet';

  // Knowledge sources ("Knowledge Orb can use") — the tenant's real documents.
  // Shares the ['orb-documents'] query with the Knowledge page.
  const { data: docs = [] } = useQuery({ queryKey: ['orb-documents'], queryFn: () => ws.listDocuments() });
  const sources = docs.map((d) => ({
    id: d.id,
    title: d.title,
    category: { label: categoryLabel(d.category), tone: CAT_TONE[d.category] || 'neutral' },
    chars: (d.content?.length || 0).toLocaleString()
  }));
  const totalChars = docs.reduce((s, d) => s + (d.content?.length || 0), 0);
  const sourcesSubtitle = `${docs.length} source${docs.length === 1 ? '' : 's'} · ${totalChars.toLocaleString()} characters`;

  // One turn against a bot: append the question, call ws.chat, append the reply.
  const ask = async (b, query, img) => {
    setThreads((t) => ({ ...t, [b]: [...t[b], { role: 'visitor', text: query, image: img || null }] }));
    setPending((p) => ({ ...p, [b]: true }));
    try {
      const payload = { botType: b, sessionId: sessions[b], language: lang };
      if (query) payload.query = query;
      if (img) payload.image = img;
      const data = await ws.chat(payload);
      setSessions((s) => ({ ...s, [b]: data.sessionId }));
      setThreads((t) => ({ ...t, [b]: [...t[b], { role: 'orb', text: data.answer, meta: data }] }));
    } catch (err) {
      setThreads((t) => ({ ...t, [b]: [...t[b], { role: 'orb', text: err.message, error: true }] }));
    } finally {
      setPending((p) => ({ ...p, [b]: false }));
    }
  };

  const send = (text) => {
    const query = String(text ?? input).trim();
    const img = image;
    if (!query && !img) return; // an image on its own is a valid message
    setInput(''); setImage(null); setImgError('');
    ask(bot, query, img);
  };

  // Image attachment: validate type + size, read into a base64 data URL.
  const pickImage = (file) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setImgError('Please choose a PNG, JPEG, WebP or GIF image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setImgError('That image is too large (max 5 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result || '')); setImgError(''); };
    reader.onerror = () => setImgError('Could not read that image.');
    reader.readAsDataURL(file);
  };

  return (
    <>
      <Head><title>Test Orb · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="orb-page-title text-orb-ink">Test Orb</h1>
              <Pill tone="yellow">Ready to install</Pill>
            </div>
            <p className="mt-1 orb-body text-orb-secondary">Day 1 · 6 Oct. Orb answers only from your knowledge. Nothing is on your website yet.</p>
          </div>

          <Banner
            icon={<IconPlay size={16} />}
            title="Ask a few real patient questions."
            body="When you’re happy with the answers, install Orb on your site."
            action={<Button variant="primary" size="md">Install on your site</Button>}
          />

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_400px]">
            <TestChatCard
              bot={bot} onBot={setBot}
              lang={lang} onLang={setLang}
              messages={threads[bot]}
              pending={pending[bot]}
              suggested={suggested}
              generating={generating}
              onRefresh={() => regen.mutate()}
              input={input} onInput={setInput}
              image={image} imgError={imgError}
              onPickImage={pickImage}
              onRemoveImage={() => { setImage(null); setImgError(''); }}
              onSend={send}
              onStarter={(q) => send(q)}
              onFollowUp={(q) => send(q)}
            />
            <div className="flex flex-col gap-7">
              <KnowledgeReadinessPanel
                score={readinessScore}
                max={100}
                status={botReport ? readinessStatus(readinessScore) : null}
                marker={{ at: 80, label: 'Ready 80' }}
                note={readinessNote}
                checkedAt={readinessCheckedAt}
                toAddTitle="What to add to reach Ready (80%)"
                toAdd={toAdd}
                onAdd={() => { window.location.href = '/knowledge'; }}
              />
              <SourcesCard subtitle={sourcesSubtitle} sources={sources} />
            </div>
          </div>
        </div>
      </OrbShell>
    </>
  );
}
