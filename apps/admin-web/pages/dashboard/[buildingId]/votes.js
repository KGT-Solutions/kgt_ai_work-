import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui, gridClass } from '../../../components/ui';
import { api } from '../../../lib/api';

export default function VotesPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [votes, setVotes] = useState([]);
  const [question, setQuestion] = useState('');
  const [closesInDays, setClosesInDays] = useState('7');
  const [optionA, setOptionA] = useState('Yes');
  const [optionB, setOptionB] = useState('No');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      setVotes(await api.getVotes(buildingId));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const createPoll = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    try {
      const closesAt = new Date();
      closesAt.setDate(closesAt.getDate() + Number(closesInDays || 7));
      await api.createVote(buildingId, {
        question: question.trim(),
        closesAt: closesAt.toISOString(),
        options: [optionA.trim() || 'Yes', optionB.trim() || 'No']
      });
      setQuestion('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!buildingId) return null;

  const openVotes = votes.filter((v) => v.isOpen);
  const closedVotes = votes.filter((v) => !v.isOpen);

  return (
    <AdminLayout buildingId={buildingId} title="Polls & votes" error={error}>
      <form onSubmit={createPoll} style={ui.form}>
        <h3 style={ui.formTitle}>Create a new poll</h3>
        <textarea
          style={ui.textarea}
          placeholder="Poll question (e.g. Should we install EV charging points?)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
        />
        <div className={gridClass.two} style={ui.row}>
          <input style={ui.input} placeholder="Option 1" value={optionA} onChange={(e) => setOptionA(e.target.value)} />
          <input style={ui.input} placeholder="Option 2" value={optionB} onChange={(e) => setOptionB(e.target.value)} />
        </div>
        <div className={gridClass.two} style={ui.row}>
          <label style={label}>
            Closes in (days)
            <input
              style={labeledInput}
              type="number"
              min="1"
              max="90"
              value={closesInDays}
              onChange={(e) => setClosesInDays(e.target.value)}
            />
          </label>
        </div>
        <button type="submit" style={submitBtn} disabled={loading}>
          {loading ? 'Creating…' : 'Create poll'}
        </button>
        <p style={ui.hint}>Residents vote anonymously. You can see turnout and results, not who voted for what.</p>
      </form>

      <h3 style={ui.sectionTitle}>Active polls</h3>
      {openVotes.length === 0 ? (
        <div style={pollEmpty}>No active polls.</div>
      ) : (
        openVotes.map((v) => (
          <PollCard key={v.id} vote={v} buildingId={buildingId} onRefresh={load} setError={setError} />
        ))
      )}

      {closedVotes.length > 0 && (
        <>
          <h3 style={ui.sectionTitle}>Closed polls</h3>
          {closedVotes.map((v) => (
            <PollCard key={v.id} vote={v} buildingId={buildingId} closed onRefresh={load} setError={setError} />
          ))}
        </>
      )}
    </AdminLayout>
  );
}

function PollCard({ vote, buildingId, closed, onRefresh, setError }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editQuestion, setEditQuestion] = useState(vote.question);
  const [editOptionA, setEditOptionA] = useState(vote.options[0]?.label || 'Yes');
  const [editOptionB, setEditOptionB] = useState(vote.options[1]?.label || 'No');
  const [editDays, setEditDays] = useState(String(Math.max(1, vote.daysLeft || 1)));
  const hasVotes = vote.totalVoted > 0;

  const endPoll = async () => {
    if (!window.confirm('End this poll now? Residents will no longer be able to vote.')) return;
    setBusy(true);
    setError('');
    try {
      await api.updateVote(buildingId, vote.id, { end: true });
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const closesAt = new Date();
      closesAt.setDate(closesAt.getDate() + Number(editDays || 1));
      await api.updateVote(buildingId, vote.id, {
        question: editQuestion.trim(),
        closesAt: closesAt.toISOString(),
        ...(!hasVotes && { options: [editOptionA.trim() || 'Yes', editOptionB.trim() || 'No'] })
      });
      setEditing(false);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deletePoll = async () => {
    if (!window.confirm('Delete this poll permanently? All votes will be lost.')) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteVote(buildingId, vote.id);
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={ui.card}>
      <div className="admin-card-header" style={cardHeader}>
        <strong>{vote.question}</strong>
        <span style={{ ...statusTag, ...(closed ? ui.tagClosed : ui.tagOpen) }}>{closed ? 'Closed' : 'Open'}</span>
      </div>
      <div style={pollMeta}>
        {vote.totalVoted} / {vote.totalMembers} members voted · {vote.turnoutPct}% turnout
        {!closed && ` · closes in ${vote.daysLeft} day${vote.daysLeft === 1 ? '' : 's'}`}
      </div>
      <div style={results}>
        {vote.options.map((o) => (
          <div key={o.id} style={resultRow}>
            <span>{o.label}</span>
            <span style={resultPct}>{o.pct}% ({o.count})</span>
          </div>
        ))}
      </div>

      {editing ? (
        <form onSubmit={saveEdit} style={editForm}>
          <textarea style={ui.textarea} value={editQuestion} onChange={(e) => setEditQuestion(e.target.value)} rows={2} />
          <div className={gridClass.two} style={ui.row}>
            <input
              style={ui.input}
              value={editOptionA}
              onChange={(e) => setEditOptionA(e.target.value)}
              disabled={hasVotes}
              placeholder="Option 1"
            />
            <input
              style={ui.input}
              value={editOptionB}
              onChange={(e) => setEditOptionB(e.target.value)}
              disabled={hasVotes}
              placeholder="Option 2"
            />
          </div>
          {!closed && (
            <label style={label}>
              Closes in (days from today)
              <input style={labeledInput} type="number" min="1" max="90" value={editDays} onChange={(e) => setEditDays(e.target.value)} />
            </label>
          )}
          {hasVotes && <p style={ui.hint}>Options cannot be changed after residents have voted.</p>}
          <div className="admin-form-actions" style={actions}>
            <button type="submit" style={ui.btnAccent} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" style={ui.btnSecondary} onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="admin-form-actions admin-actions-row" style={actions}>
          {!closed && (
            <button type="button" style={ui.btnSecondary} onClick={endPoll} disabled={busy}>End poll</button>
          )}
          <button type="button" style={ui.btnSecondary} onClick={() => setEditing(true)} disabled={busy}>Edit</button>
          <button type="button" style={ui.btnGhost} onClick={deletePoll} disabled={busy}>Delete</button>
        </div>
      )}
    </div>
  );
}

const submitBtn = { ...ui.btn, alignSelf: 'flex-start' };
const label = { fontSize: 13, color: '#374151', display: 'block' };
const labeledInput = { ...ui.input, marginTop: 6 };
const pollEmpty = { ...ui.empty, padding: 24, marginBottom: 24 };
const cardHeader = { gap: 12 };
const statusTag = { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' };
const pollMeta = { ...ui.meta, marginTop: 8 };
const results = { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 };
const resultRow = { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#374151', gap: 12, flexWrap: 'wrap' };
const resultPct = { fontWeight: 600, color: '#2B3A4A' };
const actions = { marginTop: 16 };
const editForm = { marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16, borderTop: '1px solid #E2E5E4' };
