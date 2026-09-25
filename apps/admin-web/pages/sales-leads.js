import { useEffect, useState } from 'react';
import SuperAdminLayout from '../components/SuperAdminLayout';
import StatDetailPanel from '../components/StatDetailPanel';
import { ui, colors, radius } from '../components/ui';
import { api } from '../lib/api';

const CLIENT_TYPES = ['builder', 'rwa_president', 'committee_member'];
const CLIENT_TYPE_LABELS = {
  builder: 'Builder',
  rwa_president: 'RWA President',
  committee_member: 'Committee Member'
};
const HIGH_INTENT_THRESHOLD = 40;
const PAGE_SIZE = 20;

function formatSignal(tag) {
  // "objection:payment_gateway_lag" -> "Objection: payment gateway lag"
  const [prefix, rest] = tag.includes(':') ? tag.split(':') : [null, tag];
  const text = (rest || tag).replace(/_/g, ' ');
  if (!prefix) return text;
  return `${prefix[0].toUpperCase()}${prefix.slice(1)}: ${text}`;
}

function truncate(text, max = 90) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function SalesLeadsPage() {
  const [leads, setLeads] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState('createdAt');
  const [order, setOrder] = useState('desc');
  const [clientType, setClientType] = useState('');
  const [minIntentScore, setMinIntentScore] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.listSalesLeads({ page, pageSize: PAGE_SIZE, sortBy, order, clientType, minIntentScore });
        if (cancelled) return;
        setLeads(data.leads);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, sortBy, order, clientType, minIntentScore]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setOrder('desc');
    }
    setPage(1);
  };

  const toggleHighIntentOnly = () => {
    setMinIntentScore((v) => (v === String(HIGH_INTENT_THRESHOLD + 1) ? '' : String(HIGH_INTENT_THRESHOLD + 1)));
    setPage(1);
  };

  const sortIndicator = (field) => (sortBy === field ? (order === 'desc' ? ' ▼' : ' ▲') : '');

  return (
    <SuperAdminLayout
      title="Sales leads"
      subtitle="Inquiries captured by the Sales Chatbot, ranked by buying intent."
      error={error}
      loading={loading && leads.length === 0}
    >
      <div style={filterBar}>
        <div style={filterGroup}>
          <label style={filterLabel}>Client type</label>
          <select
            style={select}
            value={clientType}
            onChange={(e) => { setClientType(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            {CLIENT_TYPES.map((c) => (
              <option key={c} value={c}>{CLIENT_TYPE_LABELS[c]}</option>
            ))}
          </select>
        </div>

        <div style={filterGroup}>
          <label style={filterLabel}>Min intent score</label>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="e.g. 40"
            style={numberInput}
            value={minIntentScore}
            onChange={(e) => { setMinIntentScore(e.target.value); setPage(1); }}
          />
        </div>

        <button
          type="button"
          style={minIntentScore === String(HIGH_INTENT_THRESHOLD + 1) ? btnToggleActive : btnToggle}
          onClick={toggleHighIntentOnly}
        >
          High-intent only ({'>'}{HIGH_INTENT_THRESHOLD})
        </button>

        {(clientType || minIntentScore) && (
          <button
            type="button"
            style={ui.btnSecondary}
            onClick={() => { setClientType(''); setMinIntentScore(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {leads.length === 0 ? (
        <div style={ui.empty}>No sales leads match these filters yet.</div>
      ) : (
        <>
          <div className="admin-table-scroll" style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Client type</th>
                  <th style={th}>Query</th>
                  <th className="admin-table-sortable" style={th} onClick={() => handleSort('intentScore')}>
                    Intent score{sortIndicator('intentScore')}
                  </th>
                  <th style={th}>Notified</th>
                  <th className="admin-table-sortable" style={th} onClick={() => handleSort('createdAt')}>
                    Created{sortIndicator('createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const isHighIntent = lead.intentScore > HIGH_INTENT_THRESHOLD;
                  return (
                    <tr key={lead.id} className="admin-table-row-clickable" onClick={() => setSelectedLead(lead)}>
                      <td style={td}>
                        <span style={ui.tag}>{CLIENT_TYPE_LABELS[lead.clientType] || lead.clientType}</span>
                      </td>
                      <td style={{ ...td, maxWidth: 360 }} title={lead.query}>
                        {truncate(lead.query)}
                      </td>
                      <td style={td}>
                        <span style={isHighIntent ? scoreHigh : scoreNormal}>{lead.intentScore}</span>
                      </td>
                      <td style={td}>
                        {lead.notifiedViaEmail ? (
                          <span style={ui.tagOpen /* reuse green "positive" tag */}>Sent</span>
                        ) : (
                          <span style={ui.tagClosed}>Not sent</span>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {new Date(lead.createdAt).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={paginationBar}>
            <span style={ui.hint}>{total} lead{total === 1 ? '' : 's'} total · page {page} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={page <= 1 ? btnDisabled : ui.btnSecondary}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                style={page >= totalPages ? btnDisabled : ui.btnSecondary}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selectedLead && (
        <StatDetailPanel title="Sales lead" onClose={() => setSelectedLead(null)}>
          <div style={metaGrid}>
            <MetaField label="Client type" value={CLIENT_TYPE_LABELS[selectedLead.clientType] || selectedLead.clientType} />
            <MetaField
              label="Intent score"
              value={<span style={selectedLead.intentScore > HIGH_INTENT_THRESHOLD ? scoreHigh : scoreNormal}>{selectedLead.intentScore}</span>}
            />
            <MetaField label="Notified via email" value={selectedLead.notifiedViaEmail ? 'Yes' : 'No'} />
            <MetaField label="Created" value={new Date(selectedLead.createdAt).toLocaleString('en-IN')} />
          </div>

          <h3 style={sectionHeading}>Prospect's message</h3>
          <p style={bodyText}>{selectedLead.query}</p>

          <h3 style={sectionHeading}>AI-generated answer</h3>
          <p style={bodyText}>{selectedLead.answer}</p>

          <h3 style={sectionHeading}>Matched objections &amp; signals</h3>
          {selectedLead.matchedObjections?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {selectedLead.matchedObjections.map((tag) => (
                <span key={tag} style={ui.tag}>{formatSignal(tag)}</span>
              ))}
            </div>
          ) : (
            <p style={ui.hint}>No specific objections or buying signals were detected on this message.</p>
          )}
        </StatDetailPanel>
      )}
    </SuperAdminLayout>
  );
}

function MetaField({ label, value }) {
  return (
    <div>
      <div style={metaLabel}>{label}</div>
      <div style={metaValue}>{value}</div>
    </div>
  );
}

const filterBar = { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, marginBottom: 20 };
const filterGroup = { display: 'flex', flexDirection: 'column', gap: 4 };
const filterLabel = { fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' };
const select = {
  padding: '8px 36px 8px 12px', borderRadius: radius.sm, border: `1px solid ${colors.border}`,
  minWidth: 160, background: '#fff', color: colors.text, fontSize: 14, cursor: 'pointer'
};
const numberInput = {
  padding: '8px 12px', borderRadius: radius.sm, border: `1px solid ${colors.border}`,
  width: 110, background: '#fff', color: colors.text, fontSize: 14
};
const btnToggle = {
  padding: '9px 14px', borderRadius: radius.sm, border: `1px solid ${colors.border}`,
  background: '#fff', color: colors.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
};
const btnToggleActive = { ...btnToggle, background: '#FEE2E2', borderColor: '#F3B7AE', color: colors.error };
const btnDisabled = { ...ui.btnSecondary, opacity: 0.45, cursor: 'not-allowed' };

const tableWrap = { borderRadius: radius.lg };
const table = { width: '100%', background: colors.card, borderCollapse: 'collapse' };
const th = {
  textAlign: 'left', padding: '12px 16px', fontSize: 12, color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`, background: '#FAFAFA', whiteSpace: 'nowrap'
};
const td = { padding: '12px 16px', fontSize: 14, color: colors.text, borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' };

const scoreHigh = {
  display: 'inline-block', padding: '4px 10px', borderRadius: radius.pill,
  background: '#FEE2E2', color: colors.error, fontWeight: 700, fontSize: 13
};
const scoreNormal = {
  display: 'inline-block', padding: '4px 10px', borderRadius: radius.pill,
  background: colors.background, color: colors.textMuted, fontWeight: 600, fontSize: 13
};

const paginationBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap', gap: 12 };

const metaGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 };
const metaLabel = { fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };
const metaValue = { fontSize: 14, color: colors.text, fontWeight: 600 };
const sectionHeading = { fontSize: 13, fontWeight: 700, color: colors.primary, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '20px 0 8px' };
const bodyText = { fontSize: 14, color: colors.text, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 };
