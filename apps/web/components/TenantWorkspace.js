import { useEffect, useRef, useState } from 'react';
import { ui, colors, radius, gridClass } from './ui';
import { embedSnippet } from '../lib/api';
import { DOC_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from '../lib/documentCategories';

// One tenant's workspace: documents, test chat, API keys, tickets, usage.
// Shared by the client dashboard (pages/dashboard.js — the company's own
// tenant) and the staff console (pages/admin/tenants/[tenantId].js — any
// tenant). `ws` is clientWorkspace() or staffWorkspace(id) from lib/api.js;
// everything here goes through it, so this component can't reach a tenant
// the session isn't allowed to.
//
// Props: ws, tenant, audience ('client' | 'staff'), notify({ error | success }),
//        freshKey (a key issued moments ago, shown once on the keys tab)

const TABS = ['Documents', 'Test bots', 'API keys', 'Tickets', 'Usage'];
const MAX_PDF_MB = 10; // mirrors the API's PDF limit

// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/services/shared/crawlConsent.js.
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and ' +
  'extract content from this domain.';

export default function TenantWorkspace({ ws, tenant, audience, notify, freshKey }) {
  const [tab, setTab] = useState(freshKey ? 'API keys' : 'Documents');
  const [documents, setDocuments] = useState(null);

  const loadDocuments = async () => {
    try {
      setDocuments(await ws.listDocuments());
    } catch (e) {
      notify({ error: e.message });
    }
  };
  useEffect(() => { loadDocuments(); }, [tenant.id]);

  return (
    <>
      <div style={tabRow} role="tablist" aria-label="Workspace">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)} style={t === tab ? tabBtnActive : tabBtn}>
            {t}{t === 'Documents' && documents ? ` (${documents.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'Documents' && (
        <DocumentsTab ws={ws} audience={audience} documents={documents} reload={loadDocuments} notify={notify} />
      )}
      {tab === 'Test bots' && <TestBotsTab ws={ws} tenant={tenant} />}
      {tab === 'API keys' && <ApiKeysTab ws={ws} tenant={tenant} notify={notify} freshKey={freshKey} />}
      {tab === 'Tickets' && <TicketsTab ws={ws} notify={notify} />}
      {tab === 'Usage' && <UsageTab ws={ws} notify={notify} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── Documents

function DocumentsTab({ ws, audience, documents, reload, notify }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [filter, setFilter] = useState('ALL');
  if (!documents) return <div style={ui.empty}>Loading documents…</div>;
  const visibleDocs = filter === 'ALL' ? documents : documents.filter((d) => d.category === filter);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <button
          type="button"
          style={showAddForm ? ui.btnSecondary : ui.btn}
          onClick={() => setShowAddForm((open) => !open)}
          aria-expanded={showAddForm}
          aria-controls="add-document-panel"
        >
          {showAddForm ? 'Close' : '+ Add knowledge'}
        </button>
        {!showAddForm && <span style={ui.hint}>Write or paste text, upload PDFs, or import pages from a website.</span>}
      </div>

      {showAddForm && (
        <AddKnowledgePanel
          ws={ws}
          audience={audience}
          onAdded={async (message) => {
            notify({ success: message });
            await reload();
          }}
        />
      )}

      <p style={{ ...ui.formTitle, marginTop: 24, marginBottom: 8 }}>Training documents ({documents.length})</p>
      <p style={{ ...ui.hint, marginBottom: 12 }}>
        Both bots answer from this list. Changes apply on the very next question. The section decides which
        bot leans on it first: FAQs for support, Overview for sales, Policies &amp; pricing for money or rules.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[{ id: 'ALL', short: 'All' }, ...DOC_CATEGORIES].map((c) => {
          const count = c.id === 'ALL' ? documents.length : documents.filter((d) => d.category === c.id).length;
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              aria-pressed={active}
              style={{ ...ui.tag, cursor: 'pointer', border: `1px solid ${active ? colors.text : colors.border}`, fontWeight: active ? 700 : 500 }}
            >
              {c.short} ({count})
            </button>
          );
        })}
      </div>
      {visibleDocs.length === 0 ? (
        <div style={ui.empty}>
          {documents.length === 0 ? 'No documents yet — the bots have nothing to answer from until you add some.' : 'No documents in this section yet.'}
        </div>
      ) : (
        <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
          <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Document</th>
                <th style={th}>Section</th>
                <th style={th}>Source</th>
                <th style={th}>Last updated</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocs.map((d) => (
                <DocumentRow key={d.id} ws={ws} doc={d} reload={reload} notify={notify} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Add knowledge: write/paste, upload PDF, or import a website. Problems show
// inline here, so the same message on a second attempt is still visible.
function AddKnowledgePanel({ ws, audience, onAdded }) {
  const [mode, setMode] = useState('write'); // 'write' | 'pdf' | 'website'
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [pdfCategory, setPdfCategory] = useState(''); // '' = auto-detect per section
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const fileRef = useRef(null);
  const isClient = audience === 'client';

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await fn();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveText = (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setProblem(!title.trim() ? 'Add a title for this document.' : 'Add some content — the bots answer from this text.');
      return;
    }
    run(async () => {
      await ws.createDocument({ title: title.trim(), content, category });
      await onAdded(`"${title.trim()}" added to ${categoryLabel(category)}.`);
      setTitle('');
      setContent('');
    });
  };

  const pickFile = (picked) => {
    setProblem('');
    if (!picked) return setFile(null);
    if (!/\.pdf$/i.test(picked.name) && picked.type !== 'application/pdf') {
      setFile(null);
      return setProblem('Choose a PDF file.');
    }
    if (picked.size > MAX_PDF_MB * 1024 * 1024) {
      setFile(null);
      return setProblem(`That file is larger than ${MAX_PDF_MB}MB.`);
    }
    setFile(picked);
  };

  const uploadPdf = (e) => {
    e.preventDefault();
    if (!file) return setProblem('Choose a PDF to upload.');
    run(async () => {
      const r = await ws.uploadPdf(file, pdfCategory);
      const where = Object.entries(r.categories).map(([c, n]) => `${n} in ${categoryLabel(c)}`).join(', ');
      await onAdded(
        `Added ${r.documentsCreated} section${r.documentsCreated === 1 ? '' : 's'} from ${r.fileName} (${where}).` +
        (r.truncated ? ' The PDF was long, so only the first part was imported.' : '')
      );
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    });
  };

  const importWebsite = (e) => {
    e.preventDefault();
    if (!url.trim()) return setProblem('Enter the website address, e.g. https://example.com');
    if (isClient && !authorized) return setProblem('Tick the authorization box to continue.');
    run(async () => {
      const r = await ws.importWebsite(url.trim(), { authorized });
      await onAdded(r.message);
      setUrl('');
    });
  };

  const modes = [['write', 'Write or paste'], ['pdf', 'Upload PDF'], ['website', 'Import website']];

  return (
    <div id="add-document-panel" style={{ ...ui.form, gap: 12 }}>
      <div role="tablist" aria-label="How to add" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {modes.map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setProblem(''); }} style={mode === m ? ui.btn : ui.btnSecondary}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'write' && (
        <form onSubmit={saveText} style={{ display: 'grid', gap: 10 }}>
          <p style={ui.hint}>
            Plain text or Markdown. Split it into <code>## Heading</code> sections — each becomes one retrievable
            chunk. Add <code>{'<!-- tags: benefit:free_shipping -->'}</code> under a heading to show that benefit as a
            Sales Bot highlight.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input id="new-doc-title" aria-label="Document title" style={{ ...ui.input, flex: '1 1 260px' }} value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Returns Policy" autoFocus />
            <CategorySelect value={category} onChange={setCategory} />
          </div>
          <textarea id="new-doc-content" aria-label="Document content" style={{ ...ui.textarea, minHeight: 160, fontFamily: 'monospace', fontSize: 13 }}
            value={content} onChange={(e) => setContent(e.target.value)}
            placeholder={'## Returns\nItems can be returned within 30 days...\n\n## Shipping\nStandard shipping takes 5-7 business days.'} />
          <div><button type="submit" style={ui.btn} disabled={busy}>{busy ? 'Saving…' : 'Save document'}</button></div>
        </form>
      )}

      {mode === 'pdf' && (
        <form onSubmit={uploadPdf} style={{ display: 'grid', gap: 10 }}>
          <p style={ui.hint}>Text-based PDFs up to {MAX_PDF_MB}MB (manuals, FAQs, price lists). Headings become separate sections. Scanned images can't be read.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* A real <label> around the input opens the native file picker on every browser. */}
            <label style={{ ...ui.btnSecondary, position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              Choose PDF…
              <input ref={fileRef} id="new-doc-pdf" type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0])}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} />
            </label>
            <span style={{ ...ui.meta, marginTop: 0 }}>{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : 'No file chosen'}</span>
          </div>
          <select aria-label="File the sections under" style={{ ...ui.input, width: 'auto', maxWidth: 360 }} value={pdfCategory} onChange={(e) => setPdfCategory(e.target.value)}>
            <option value="">Auto-detect section for each part</option>
            {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>All into: {c.label}</option>)}
          </select>
          <div><button type="submit" style={ui.btn} disabled={busy || !file}>{busy ? 'Reading PDF…' : 'Upload and add'}</button></div>
        </form>
      )}

      {mode === 'website' && (
        <form onSubmit={importWebsite} style={{ display: 'grid', gap: 10 }}>
          <p style={ui.hint}>
            Crawls up to 12 same-domain pages (About, FAQ, Support, Pricing and pages linked from them), strips menus
            and footers, and adds each page as a document. {isClient ? '' : 'Staff imports can also render JavaScript-only sites.'}
          </p>
          <input id="import-url" aria-label="Website address" type="url" style={ui.input} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com" disabled={busy} />
          {isClient && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: colors.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} style={{ marginTop: 3 }} />
              <span>{CRAWL_CONSENT_TEXT}</span>
            </label>
          )}
          <div>
            <button type="submit" style={ui.btn} disabled={busy || !url.trim() || (isClient && !authorized)}>
              {busy ? 'Importing pages… (up to a minute)' : 'Import website'}
            </button>
          </div>
        </form>
      )}

      {problem && <p role="alert" style={{ margin: 0, fontSize: 13, color: '#B4483A' }}>{problem}</p>}
    </div>
  );
}

function DocumentRow({ ws, doc, reload, notify }) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.title);
  const [draftContent, setDraftContent] = useState(doc.content);
  const [draftCategory, setDraftCategory] = useState(doc.category || DEFAULT_CATEGORY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = () => {
    setDraftTitle(doc.title);
    setDraftContent(doc.content);
    setDraftCategory(doc.category || DEFAULT_CATEGORY);
    setEditing(true);
  };

  const save = async () => {
    if (busy) return;
    if (!draftTitle.trim() || !draftContent.trim()) return notify({ error: 'Title and content cannot be empty.' });
    setBusy(true);
    try {
      await ws.updateDocument(doc.id, { title: draftTitle.trim(), content: draftContent, category: draftCategory });
      notify({ success: `"${draftTitle.trim()}" updated.` });
      setEditing(false);
      await reload();
    } catch (e) {
      notify({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ws.deleteDocument(doc.id);
      notify({ success: `"${doc.title}" deleted.` });
      await reload();
    } catch (e) {
      notify({ error: e.message });
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <tr>
        <td style={td} colSpan={5}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <input style={{ ...ui.input, flex: '1 1 260px' }} value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} aria-label="Document title" />
            <CategorySelect value={draftCategory} onChange={setDraftCategory} />
          </div>
          <textarea style={{ ...ui.textarea, minHeight: 180, fontFamily: 'monospace', fontSize: 13 }} value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)} aria-label="Document content" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={ui.btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" style={ui.btnSecondary} onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={td}>
        <strong>{doc.title}</strong>
        <p style={{ ...ui.meta, whiteSpace: 'pre-wrap', marginTop: 6, maxWidth: 440 }}>
          {doc.content.length > 220 ? `${doc.content.slice(0, 220)}…` : doc.content}
        </p>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={ui.tag}>{categoryLabel(doc.category)}</span></td>
      <td style={td}>
        {doc.sourceUrl ? (
          <a href={doc.sourceUrl} target="_blank" rel="noreferrer" style={{ ...ui.tag, textDecoration: 'none' }}>Website</a>
        ) : (
          <span style={ui.tag}>Added</span>
        )}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(doc.updatedAt || doc.createdAt).toLocaleString('en-IN')}</td>
      <td style={td}>
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={ui.meta}>Delete from both bots?</span>
            <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
            <button type="button" style={linkBtn} onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={linkBtn} onClick={startEdit}>Edit</button>
            <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={() => setConfirmDelete(true)}>Delete…</button>
          </div>
        )}
      </td>
    </tr>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <select aria-label="Document section" style={{ ...ui.input, flex: '0 1 230px', width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
      {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────── Test bots
// Chats with the tenant's live bots, authenticated by the signed-in session
// (API keys are stored hashed and can't be read back). Same engine, same
// knowledge and same rate limit as the embedded widget.
function TestBotsTab({ ws, tenant }) {
  const [botType, setBotType] = useState('support');
  const [messages, setMessages] = useState({ support: [], sales: [] });
  const [sessionIds, setSessionIds] = useState({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, botType, sending]);

  const send = async (e) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || sending) return;
    const bot = botType; // the user may switch bots mid-request
    setInput('');
    setSending(true);
    setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'user', text: query }] }));
    try {
      const data = await ws.chat({ query, botType: bot, sessionId: sessionIds[bot] });
      setSessionIds((s) => ({ ...s, [bot]: data.sessionId }));
      setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'bot', text: data.answer, meta: data }] }));
    } catch (err) {
      setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'bot', text: err.message, error: true }] }));
    } finally {
      setSending(false);
    }
  };

  const list = messages[botType];

  return (
    <div style={ui.form}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <p style={{ ...ui.formTitle, margin: 0, marginRight: 'auto' }}>Chat with {tenant.name}'s bots</p>
        {['support', 'sales'].map((b) => (
          <button key={b} type="button" aria-pressed={b === botType} onClick={() => setBotType(b)} style={b === botType ? ui.btn : ui.btnSecondary}>
            {b === 'support' ? 'Support Bot' : 'Sales Bot'}
          </button>
        ))}
      </div>

      <div ref={scrollRef} style={chatBox} aria-live="polite">
        {list.length === 0 && (
          <p style={{ ...ui.hint, margin: 'auto', textAlign: 'center' }}>
            {botType === 'support'
              ? 'Ask a question your documents answer, then an off-topic one to see the bot hand off politely.'
              : 'Ask about benefits, pricing or an objection. Tagged benefits appear under the reply.'}
          </p>
        )}
        {list.map((m, i) => (
          <div key={i} style={m.role === 'user' ? bubbleUser : m.error ? bubbleError : bubbleBot}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            {m.meta && <BotMeta meta={m.meta} />}
          </div>
        ))}
        {sending && <div style={{ ...bubbleBot, color: colors.textMuted }}>Thinking…</div>}
      </div>

      <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...ui.input, flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message"
          placeholder={`Ask the ${botType === 'support' ? 'Support' : 'Sales'} Bot…`} disabled={sending} />
        <button type="submit" style={ui.btn} disabled={sending || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

// What the engine decided, under each reply: a grounded answer, a handoff, or
// an LLM outage.
function BotMeta({ meta }) {
  const bits = [];
  if (meta.degraded) bits.push('The AI service was unavailable — the question was logged as a ticket');
  if (meta.sourceSection) bits.push(`Source: ${meta.sourceSection}`);
  if (typeof meta.confidence === 'number') bits.push(`Handed off · match ${Math.round(meta.confidence * 100)}%`);
  if (meta.keyBenefitsHighlighted?.length) bits.push(`Benefits: ${meta.keyBenefitsHighlighted.join(', ')}`);
  if (!bits.length) return null;
  return <div style={{ ...ui.meta, marginTop: 6 }}>{bits.join(' · ')}</div>;
}

// ─────────────────────────────────────────────────────────────── API keys

function ApiKeysTab({ ws, tenant, notify, freshKey }) {
  const [keys, setKeys] = useState(null);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(freshKey ? { apiKey: freshKey, label: 'Website widget' } : null); // shown once
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const load = async () => {
    try {
      setKeys(await ws.listApiKeys());
    } catch (e) {
      notify({ error: e.message });
    }
  };
  useEffect(() => { load(); }, [tenant.id]);

  const issue = async (e) => {
    e.preventDefault();
    if (issuing) return;
    setIssuing(true);
    try {
      const created = await ws.createApiKey(label.trim() || 'Default');
      setIssued(created);
      setLabel('');
      notify({ success: `Key "${created.label}" issued. Copy it now — it can't be shown again.` });
      await load();
    } catch (e2) {
      notify({ error: e2.message });
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (key, force) => {
    try {
      await ws.revokeApiKey(key.id, { force });
      setConfirmRevoke(null);
      notify({ success: `Key ${key.keyPrefix}… revoked. Requests using it are rejected immediately.` });
      await load();
    } catch (e) {
      notify({ error: e.message });
    }
  };

  const live = (keys || []).filter((k) => !k.revokedAt);

  return (
    <>
      {issued && (
        <div style={{ ...ui.form, background: '#FFFBEB', border: '1px solid #F0B429' }}>
          <p style={ui.formTitle}>Your {issued.label ? `"${issued.label}" ` : ''}API key — copy it now</p>
          <p style={ui.hint}>For security it's stored only as a fingerprint and can't be shown again. If it's lost, issue a new one below.</p>
          <CopyRow value={issued.apiKey} label="API key" />
          <p style={{ ...ui.hint, marginTop: 10 }}>Add the bots to your website: paste this before <code>{'</body>'}</code>.</p>
          <CopyRow value={embedSnippet(tenant.slug, issued.apiKey)} label="Embed snippet" />
        </div>
      )}

      <form onSubmit={issue} style={ui.form}>
        <p style={ui.formTitle}>Issue a new key</p>
        <p style={ui.hint}>To rotate without downtime: issue a new key, update the snippet on your site, then revoke the old key.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input style={{ ...ui.input, flex: '1 1 240px' }} value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. Website widget" maxLength={80} aria-label="Key label" />
          <button type="submit" style={ui.btn} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue key'}</button>
        </div>
      </form>

      <p style={{ ...ui.formTitle, marginTop: 28, marginBottom: 12 }}>Keys ({live.length} active)</p>
      {keys === null ? null : keys.length === 0 ? (
        <div style={ui.empty}>No keys yet — the bots can't be embedded until one is issued.</div>
      ) : (
        <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
          <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Key</th><th style={th}>Label</th><th style={th}>Created</th><th style={th}>Last used</th><th style={th}>Status</th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{k.keyPrefix}…</td>
                  <td style={td}>{k.label}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(k.createdAt).toLocaleString('en-IN')}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-IN') : 'Never'}</td>
                  <td style={td}>
                    {k.revokedAt ? (
                      <span style={{ ...ui.tag, ...ui.tagClosed }}>Revoked</span>
                    ) : confirmRevoke === k.id ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <span style={ui.meta}>{live.length === 1 ? 'Last active key — the widget will stop working.' : 'Revoke now?'}</span>
                        <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={() => revoke(k, live.length === 1)}>Revoke</button>
                        <button type="button" style={linkBtn} onClick={() => setConfirmRevoke(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ ...ui.tag, ...ui.tagOpen }}>Active</span>
                        <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={() => setConfirmRevoke(k.id)}>Revoke…</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CopyRow({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked — the field stays selectable
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input readOnly value={value} aria-label={label} style={{ ...ui.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <button type="button" style={ui.btnSecondary} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Tickets & usage

function TicketsTab({ ws, notify }) {
  const [tickets, setTickets] = useState(null);
  useEffect(() => { ws.listTickets().then(setTickets).catch((e) => notify({ error: e.message })); }, []);
  if (!tickets) return <div style={ui.empty}>Loading…</div>;
  if (!tickets.length) return <div style={ui.empty}>No tickets — every question so far was answered.</div>;
  return (
    <>
      <p style={{ ...ui.hint, marginBottom: 12 }}>Questions the bots couldn't answer from your documents. Add the missing information as a document so they can next time.</p>
      <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
        <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Question</th><th style={th}>Match</th><th style={th}>Status</th><th style={th}>Asked</th></tr></thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td style={td}>{t.query}</td>
                <td style={td}>{Math.round(t.confidence * 100)}%</td>
                <td style={td}><span style={ui.tag}>{t.status}</span></td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(t.createdAt).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsageTab({ ws, notify }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => { ws.getUsage().then(setUsage).catch((e) => notify({ error: e.message })); }, []);
  if (!usage) return <div style={ui.empty}>Loading…</div>;
  const n = (v) => Number(v) || 0;
  const tiles = [
    { label: 'Conversations', value: n(usage.conversations).toLocaleString('en-IN') },
    { label: 'Questions asked', value: n(usage.questions).toLocaleString('en-IN') },
    { label: 'AI answers generated', value: n(usage.calls).toLocaleString('en-IN') },
    { label: 'Tokens (prompt / reply)', value: `${n(usage.promptTokens).toLocaleString('en-IN')} / ${n(usage.completionTokens).toLocaleString('en-IN')}` }
  ];
  return (
    <div className={gridClass.four} style={ui.statGrid}>
      {tiles.map((t) => (
        <div key={t.label} style={{ ...ui.statCard, cursor: 'default' }}>
          <div style={ui.hint}>{t.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.primary, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── styles

const tabRow = { display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' };
const tabBtn = {
  padding: '10px 4px', marginRight: 20, background: 'none', border: 'none', borderBottom: '2px solid transparent',
  color: colors.textMuted, fontWeight: 600, fontSize: 14, cursor: 'pointer'
};
const tabBtnActive = { ...tabBtn, color: colors.primary, borderBottomColor: colors.primary };
const th = {
  textAlign: 'left', padding: '12px 16px', fontSize: 12, color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`, background: '#FAFAFA', whiteSpace: 'nowrap'
};
const td = { padding: '12px 16px', fontSize: 14, color: colors.text, borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' };
const chatBox = {
  display: 'flex', flexDirection: 'column', gap: 8, height: 340, overflowY: 'auto', padding: 12,
  background: '#FAFAFA', border: `1px solid ${colors.border}`, borderRadius: radius.lg
};
const bubbleBase = { maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.45 };
const bubbleUser = { ...bubbleBase, alignSelf: 'flex-end', background: colors.primary, color: '#fff' };
const bubbleBot = { ...bubbleBase, alignSelf: 'flex-start', background: colors.card, border: `1px solid ${colors.border}`, color: colors.text };
const bubbleError = { ...bubbleBot, background: '#FBEDEB', color: '#B4483A', borderColor: '#F0C9C3' };
const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3D6B8C', fontWeight: 600, fontSize: 13 };
