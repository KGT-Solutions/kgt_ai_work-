import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import OperatorLayout from '../../components/OperatorLayout';
import { ui, colors, radius, gridClass } from '../../components/ui';
import { api, BASE_URL } from '../../lib/api';
import { DOC_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from '../../lib/documentCategories';

const TABS = ['Documents', 'Test bots', 'API keys', 'Tickets', 'Usage'];

export default function TenantDetailPage() {
  const router = useRouter();
  const { tenantId } = router.query;

  const [tenant, setTenant] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [usage, setUsage] = useState(null);
  const [tab, setTab] = useState('Documents');
  // A key issued in the API keys tab this visit, so the Test bots tab can use
  // it without the operator pasting it back in. Never stored anywhere else.
  const [sessionKey, setSessionKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [t, docs, tix, use] = await Promise.all([
        api.getTenant(tenantId),
        api.getTenantDocuments(tenantId),
        api.getTenantTickets(tenantId),
        api.getTenantUsage(tenantId)
      ]);
      setTenant(t);
      setDocuments(docs);
      setTickets(tix);
      setUsage(use);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const toggleActive = async () => {
    setError('');
    try {
      await api.updateTenant(tenantId, { active: !tenant.active });
      setSuccess(tenant.active ? 'Tenant deactivated — its chat endpoint will now reject requests.' : 'Tenant reactivated.');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <OperatorLayout
      title={tenant?.name || 'Tenant'}
      subtitle={tenant ? `${tenant.industryLabel} · ${tenant.slug}` : ''}
      error={error}
      success={success}
      loading={loading}
    >
      {tenant && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={tenant.active ? ui.tagOpen : ui.tagClosed}>{tenant.active ? 'Active' : 'Inactive'}</span>
            <span style={ui.hint}>Gate threshold: {Math.round(tenant.minConfidence * 100)}%</span>
            <button type="button" style={{ ...ui.btnSecondary, marginLeft: 'auto', padding: '6px 14px' }} onClick={toggleActive}>
              {tenant.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>

          <div style={tabRow}>
            {TABS.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} style={t === tab ? tabBtnActive : tabBtn}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'Documents' && (
            <DocumentsTab tenantId={tenantId} documents={documents} onSaved={load} setError={setError} setSuccess={setSuccess} />
          )}
          {tab === 'Test bots' && (
            <TestBotsTab
              tenant={tenant}
              apiKey={sessionKey}
              setApiKey={setSessionKey}
              goToKeys={() => setTab('API keys')}
            />
          )}
          {tab === 'API keys' && (
            <ApiKeysTab
              tenant={tenant}
              setError={setError}
              setSuccess={setSuccess}
              onIssued={(key) => setSessionKey(key)}
              goToTest={() => setTab('Test bots')}
            />
          )}
          {tab === 'Tickets' && <TicketsTab tickets={tickets} />}
          {tab === 'Usage' && <UsageTab usage={usage} />}
        </>
      )}
    </OperatorLayout>
  );
}

function DocumentsTab({ tenantId, documents, onSaved, setError, setSuccess }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [saving, setSaving] = useState(false);
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const visibleDocs = filter === 'ALL' ? documents : documents.filter((d) => d.category === filter);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      await api.createTenantDocument(tenantId, { title: title.trim(), content, category });
      setSuccess(`"${title.trim()}" added to ${categoryLabel(category)} — searchable immediately, no restart needed.`);
      setTitle('');
      setContent('');
      await onSaved();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const startAutoTrain = async (e) => {
    e.preventDefault();
    setError('');
    if (scraping) return; // re-entrancy guard — the button also disables, but that lags a render
    const url = scrapeUrl.trim();
    if (!url) {
      setError('Enter the company website URL to crawl.');
      return;
    }
    setScraping(true);
    try {
      const result = await api.scrapeTenantUrl(tenantId, url);
      setSuccess(result.message);
      setScrapeUrl('');
      await onSaved();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setScraping(false);
    }
  };

  return (
    <>
      <form onSubmit={startAutoTrain} style={{ ...ui.form, ...autoTrainCard }}>
        <p style={ui.formTitle}>Auto-train from website URL</p>
        <p style={ui.hint}>
          Point this at the company's own site (e.g. <code>https://example.com</code>) to
          crawl same-domain pages — About, FAQ, Support, Pricing, and anything linked from them — strip
          the page chrome, and save each page as a training document below.
        </p>
        <div style={autoTrainRow}>
          <input
            style={{ ...ui.input, flex: 1 }}
            value={scrapeUrl}
            onChange={(e) => setScrapeUrl(e.target.value)}
            placeholder="https://example.com"
            type="url"
            disabled={scraping}
          />
          <button type="submit" style={ui.btnAccent} disabled={scraping || !scrapeUrl.trim()}>
            {scraping ? 'Crawling pages and training bots…' : 'Start Auto-Training'}
          </button>
        </div>
        {scraping && (
          <p style={{ ...ui.hint, marginTop: 8 }}>
            Crawling same-domain pages, converting them to training documents, and re-indexing both
            bots — usually under 30 seconds, up to a minute for JavaScript-heavy sites that need a
            headless browser.
          </p>
        )}
      </form>

      <form onSubmit={submit} style={ui.form}>
        <p style={ui.formTitle}>Add a document</p>
        <p style={ui.hint}>
          Plain text or Markdown. Split it into <code>## Heading</code> sections — each becomes one
          retrievable chunk. Add <code>{'<!-- tags: benefit:free_shipping -->'}</code> under a heading to
          show that benefit as a Sales Bot highlight.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            style={{ ...ui.input, flex: '1 1 260px' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Returns Policy"
          />
          <CategorySelect value={category} onChange={setCategory} />
        </div>
        <textarea
          style={{ ...ui.textarea, minHeight: 160, fontFamily: 'monospace', fontSize: 13 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'## Returns\nItems can be returned within 30 days...\n\n## Shipping\nStandard shipping takes 5-7 business days.'}
        />
        <button type="submit" style={ui.btn} disabled={saving}>{saving ? 'Adding…' : 'Add document'}</button>
      </form>

      <p style={{ ...ui.formTitle, marginTop: 28, marginBottom: 12 }}>
        Training documents ({documents.length})
      </p>
      <p style={{ ...ui.hint, marginTop: -8, marginBottom: 12 }}>
        Both the support and sales bot read from this same list — edit a chunk, delete an outdated
        one, or add a custom markdown note above. Changes are searchable on the very next question,
        no restart needed. The section a document is filed under decides which bot leans on it first:
        FAQs for support, Overview for sales, Policies &amp; pricing for any money or rules question.
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
              style={{ ...ui.tag, cursor: 'pointer', border: `1px solid ${active ? colors.text : colors.border}`, fontWeight: active ? 700 : 500 }}
            >
              {c.short} ({count})
            </button>
          );
        })}
      </div>
      {visibleDocs.length === 0 ? (
        <div style={ui.empty}>
          {documents.length === 0
            ? 'No documents yet — the bot has nothing to answer from until you add one.'
            : 'No documents in this section yet.'}
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
                <DocumentRow
                  key={d.id}
                  tenantId={tenantId}
                  doc={d}
                  onSaved={onSaved}
                  setError={setError}
                  setSuccess={setSuccess}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DocumentRow({ tenantId, doc, onSaved, setError, setSuccess }) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.title);
  const [draftContent, setDraftContent] = useState(doc.content);
  const [draftCategory, setDraftCategory] = useState(doc.category || DEFAULT_CATEGORY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startEdit = () => {
    setDraftTitle(doc.title);
    setDraftContent(doc.content);
    setDraftCategory(doc.category || DEFAULT_CATEGORY);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return; // re-entrancy guard — disabled={saving} lags a render behind a fast double-click
    if (!draftTitle.trim() || !draftContent.trim()) {
      setError('Title and content cannot be empty.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateTenantDocument(tenantId, doc.id, {
        title: draftTitle.trim(),
        content: draftContent,
        category: draftCategory
      });
      setSuccess(`"${draftTitle.trim()}" updated — both bots pick it up on their next question.`);
      setEditing(false);
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    if (!window.confirm(`Delete "${doc.title}"? This removes it from both bots immediately.`)) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteTenantDocument(tenantId, doc.id);
      setSuccess(`"${doc.title}" deleted.`);
      await onSaved();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <tr>
        <td style={td} colSpan={5}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <input
              style={{ ...ui.input, flex: '1 1 260px' }}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Document title"
            />
            <CategorySelect value={draftCategory} onChange={setDraftCategory} />
          </div>
          <textarea
            style={{ ...ui.textarea, minHeight: 180, fontFamily: 'monospace', fontSize: 13 }}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={ui.btn} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={ui.btnSecondary} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
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
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <span style={ui.tag}>{categoryLabel(doc.category)}</span>
      </td>
      <td style={td}>
        {doc.sourceUrl ? (
          <a href={doc.sourceUrl} target="_blank" rel="noreferrer" style={{ ...ui.tag, textDecoration: 'none' }}>
            Scraped
          </a>
        ) : (
          <span style={ui.tag}>Manual</span>
        )}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        {new Date(doc.updatedAt || doc.createdAt).toLocaleString('en-IN')}
      </td>
      <td style={td}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={linkBtn} onClick={startEdit}>Edit</button>
          <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={remove} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function CategorySelect({ value, onChange }) {
  return (
    <select
      aria-label="Document section"
      style={{ ...ui.input, flex: '0 1 230px', width: 'auto' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

// Chats with the tenant's live bots through the same public endpoint the
// embed widget uses, so what you see here is exactly what customers get.
// Needs a plaintext API key: the one just issued in the API keys tab, or one
// pasted in (keys are stored hashed and can't be read back).
function TestBotsTab({ tenant, apiKey, setApiKey, goToKeys }) {
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
    if (!query || sending || !apiKey) return;
    const bot = botType; // the operator may switch tabs mid-request
    setInput('');
    setSending(true);
    setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'user', text: query }] }));
    try {
      const res = await fetch(`${BASE_URL}/api/v1/tenant-chat/${encodeURIComponent(tenant.slug)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
        body: JSON.stringify({ query, botType: bot, sessionId: sessionIds[bot] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `The bot returned HTTP ${res.status}`);
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
          <button
            key={b}
            type="button"
            onClick={() => setBotType(b)}
            style={b === botType ? ui.btn : ui.btnSecondary}
          >
            {b === 'support' ? 'Support Bot' : 'Sales Bot'}
          </button>
        ))}
      </div>

      <label style={{ ...ui.hint, display: 'block' }} htmlFor="test-api-key">
        API key used for this test ({' '}
        <button type="button" style={linkBtn} onClick={goToKeys}>issue a test key</button> if you don't have one)
      </label>
      <input
        id="test-api-key"
        style={{ ...ui.input, fontFamily: 'monospace' }}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value.trim())}
        placeholder="tk_…"
        autoComplete="off"
      />

      <div ref={scrollRef} style={chatBox} aria-live="polite">
        {list.length === 0 && (
          <p style={{ ...ui.hint, margin: 'auto', textAlign: 'center' }}>
            {botType === 'support'
              ? 'Ask a factual question the documents answer, then an off-topic one to see the confidence gate hand off.'
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
        <input
          style={{ ...ui.input, flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={apiKey ? `Ask the ${botType === 'support' ? 'Support' : 'Sales'} Bot…` : 'Enter an API key above first'}
          disabled={sending || !apiKey}
        />
        <button type="submit" style={ui.btn} disabled={sending || !apiKey || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

// What the engine decided, shown under each bot reply so operators can tell
// a grounded answer from a gate fallback or a degraded (LLM-down) reply.
function BotMeta({ meta }) {
  const bits = [];
  if (meta.degraded) bits.push('Degraded: LLM unavailable, raw excerpt shown');
  if (meta.sourceSection) bits.push(`Source: ${meta.sourceSection}`);
  if (typeof meta.confidence === 'number') bits.push(`Fallback · confidence ${Math.round(meta.confidence * 100)}%`);
  if (meta.keyBenefitsHighlighted?.length) bits.push(`Benefits: ${meta.keyBenefitsHighlighted.join(', ')}`);
  if (!bits.length) return null;
  return <div style={{ ...ui.meta, marginTop: 6 }}>{bits.join(' · ')}</div>;
}

function ApiKeysTab({ tenant, setError, setSuccess, onIssued, goToTest }) {
  const [keys, setKeys] = useState(null);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null); // { apiKey, label } — shown once
  const [confirmRevoke, setConfirmRevoke] = useState(null); // key id awaiting confirmation

  const load = async () => {
    try {
      setKeys(await api.listApiKeys(tenant.id));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, [tenant.id]);

  const issue = async (e) => {
    e.preventDefault();
    if (issuing) return;
    setIssuing(true);
    setError('');
    try {
      const created = await api.createApiKey(tenant.id, label.trim() || 'Default');
      setIssued(created);
      onIssued(created.apiKey);
      setLabel('');
      setSuccess(`Key "${created.label}" issued. Copy it now — it can't be shown again.`);
      await load();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (key, force = false) => {
    setError('');
    try {
      await api.revokeApiKey(tenant.id, key.id, { force });
      setConfirmRevoke(null);
      setSuccess(`Key ${key.keyPrefix}… revoked. Requests using it are rejected immediately.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const live = (keys || []).filter((k) => !k.revokedAt);
  const embed = issued
    ? `<script src="${BASE_URL}/widgets/tenant-chat-widget.js" data-tenant-id="${tenant.slug}" data-api-key="${issued.apiKey}" defer></script>`
    : '';

  return (
    <>
      <form onSubmit={issue} style={ui.form}>
        <p style={ui.formTitle}>Issue a new key</p>
        <p style={ui.hint}>
          To rotate without downtime: issue a new key, update the embed snippet on the customer's site,
          then revoke the old key here.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            style={{ ...ui.input, flex: '1 1 240px' }}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. Website widget or Console test"
            maxLength={80}
          />
          <button type="submit" style={ui.btn} disabled={issuing}>{issuing ? 'Issuing…' : 'Issue key'}</button>
        </div>
      </form>

      {issued && (
        <div style={{ ...ui.form, ...autoTrainCard }}>
          <p style={ui.formTitle}>New key: {issued.label}</p>
          <p style={ui.hint}>Shown once. Store it somewhere safe before leaving this page.</p>
          <CopyRow value={issued.apiKey} />
          <p style={{ ...ui.hint, marginTop: 10 }}>Embed snippet for this key:</p>
          <CopyRow value={embed} />
          <button type="button" style={{ ...ui.btnSecondary, marginTop: 10 }} onClick={goToTest}>
            Test the bots with this key
          </button>
        </div>
      )}

      <p style={{ ...ui.formTitle, marginTop: 28, marginBottom: 12 }}>
        Keys ({live.length} active)
      </p>
      {keys === null ? null : keys.length === 0 ? (
        <div style={ui.empty}>No keys yet — the tenant's bots can't be reached until one is issued.</div>
      ) : (
        <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
          <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Key</th>
                <th style={th}>Label</th>
                <th style={th}>Created</th>
                <th style={th}>Last used</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{k.keyPrefix}…</td>
                  <td style={td}>{k.label}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(k.createdAt).toLocaleString('en-IN')}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-IN') : 'Never'}
                  </td>
                  <td style={td}>
                    {k.revokedAt ? (
                      <span style={ui.tagClosed}>Revoked</span>
                    ) : confirmRevoke === k.id ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <span style={ui.meta}>
                          {live.length === 1 ? 'Last active key — the bots go offline.' : 'Revoke now?'}
                        </span>
                        <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={() => revoke(k, live.length === 1)}>
                          Revoke
                        </button>
                        <button type="button" style={linkBtn} onClick={() => setConfirmRevoke(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={ui.tagOpen}>Active</span>
                        <button type="button" style={{ ...linkBtn, color: '#B4483A' }} onClick={() => setConfirmRevoke(k.id)}>
                          Revoke…
                        </button>
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

function CopyRow({ value }) {
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
      <input readOnly value={value} style={{ ...ui.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <button type="button" style={ui.btnSecondary} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function TicketsTab({ tickets }) {
  if (!tickets.length) return <div style={ui.empty}>No support tickets — every question so far cleared the confidence gate.</div>;
  return (
    <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
      <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Query</th>
            <th style={th}>Confidence</th>
            <th style={th}>Status</th>
            <th style={th}>Filed</th>
          </tr>
        </thead>
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
  );
}

function UsageTab({ usage }) {
  if (!usage) return null;
  // A brand-new tenant with zero UsageLog rows is exactly the case a
  // Postgres SUM() returns NULL for (not 0) unless the backend coalesces it
  // — coerce here so the first time anyone opens a freshly-created tenant's
  // Usage tab, it renders zeroes instead of throwing on undefined.
  const n = (v) => Number(v) || 0;
  const tiles = [
    { label: 'LLM calls', value: n(usage.calls).toLocaleString('en-IN') },
    { label: 'Prompt tokens', value: n(usage.promptTokens).toLocaleString('en-IN') },
    { label: 'Completion tokens', value: n(usage.completionTokens).toLocaleString('en-IN') },
    { label: 'Estimated cost', value: `$${n(usage.estimatedCostUsd).toFixed(4)}` }
  ];
  return (
    <>
      <div className={gridClass.four} style={ui.statGrid}>
        {tiles.map((t) => (
          <div key={t.label} style={{ ...ui.statCard, cursor: 'default' }}>
            <div style={ui.hint}>{t.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: colors.primary, marginTop: 6 }}>{t.value}</div>
          </div>
        ))}
      </div>
      <p style={{ ...ui.hint, marginTop: 16 }}>
        Rough estimate from list pricing, not a billing-grade figure — this is the table a Stripe
        metered-billing sync job would read from.
      </p>
    </>
  );
}

const autoTrainCard = { background: '#F7FAF9', border: `1px solid ${colors.border}` };
const autoTrainRow = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' };
const tabRow = { display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${colors.border}` };
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
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: '#3D6B8C', fontWeight: 600, fontSize: 13
};
