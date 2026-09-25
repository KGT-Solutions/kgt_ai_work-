import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import AdminLayout from '../../../components/AdminLayout';
import ApprovalCard from '../../../components/ApprovalCard';
import StatDetailPanel from '../../../components/StatDetailPanel';
import { ui, gridClass } from '../../../components/ui';
import { api, mediaUrl } from '../../../lib/api';
import { displayTowerName } from '../../../lib/towers';
import { showConfirm, showError } from '../../../components/AppAlert';

const TILES = [
  { key: 'flats', label: 'Flats occupied', detailTitle: 'Flat occupancy' },
  { key: 'dues', label: 'Dues pending', detailTitle: 'Pending maintenance dues' },
  { key: 'complaints', label: 'Open complaints', detailTitle: 'Open complaints' },
  { key: 'visitors', label: "Today's visitors", detailTitle: "Today's visitors" }
];

export default function DashboardHome() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [stats, setStats] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTile, setActiveTile] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);

  // Guards against a stale response overwriting newer data if two load()s
  // ever end up in flight and resolve out of order.
  const loadSeq = useRef(0);

  const load = async () => {
    if (!buildingId) return;
    const seq = ++loadSeq.current;
    setError('');
    try {
      const [dashboard, pending] = await Promise.all([
        api.getDashboard(buildingId),
        api.getApprovals(buildingId)
      ]);
      if (seq !== loadSeq.current) return; // a newer load already superseded this one
      setStats(dashboard);
      setApprovals(pending);
      if (dashboard?.building?.buildingCode) {
        // Isolated from the outer try/catch on purpose: dashboard/approvals
        // data above already rendered successfully, so a corrupt/stale
        // localStorage cache entry here must not overwrite a working
        // dashboard with a cryptic JSON-parse error banner.
        try {
          const memberships = JSON.parse(window.localStorage.getItem('memberships') || '[]')
            .filter((m) => m.role === 'building_admin' || m.role === 'committee_member');
          const next = memberships.map((m) =>
            m.buildingId === buildingId
              ? { ...m, buildingName: dashboard.building.name, buildingCode: dashboard.building.buildingCode }
              : m
          );
          window.localStorage.setItem('memberships', JSON.stringify(next));
        } catch { /* stale/corrupt cache entry — non-fatal, dashboard data already set above */ }
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e.message);
    } finally {
      if (seq === loadSeq.current) setInitialLoading(false);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const decide = async (membershipId, status) => {
    setLoading(true);
    try {
      await api.setApproval(buildingId, membershipId, status);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openTile = async (key) => {
    setActiveTile(key);
    setDetailLoading(true);
    setDetailData(null);
    try {
      if (key === 'flats') {
        setDetailData({ flats: await api.getFlats(buildingId) });
      } else if (key === 'dues') {
        const bills = await api.getBills(buildingId);
        setDetailData({ bills: bills.filter((b) => b.status === 'due' || b.status === 'partial') });
      } else if (key === 'complaints') {
        const complaints = await api.getComplaints(buildingId);
        setDetailData({ complaints: complaints.filter((c) => c.status !== 'resolved') });
      } else if (key === 'visitors') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const visitors = await api.getVisitors(buildingId);
        setDetailData({
          visitors: visitors.filter((v) => new Date(v.entryTime) >= start)
        });
      }
    } catch (e) {
      setError(e.message);
      setActiveTile(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDuesDetail = async () => {
    const bills = await api.getBills(buildingId);
    setDetailData({ bills: bills.filter((b) => b.status === 'due' || b.status === 'partial') });
    const dashboard = await api.getDashboard(buildingId);
    setStats(dashboard);
  };

  const closeTile = () => {
    setActiveTile(null);
    setDetailData(null);
  };

  const tileValue = (key) => {
    if (!stats) return '—';
    if (key === 'flats') return `${stats.flatsOccupied} / ${stats.flatsTotal}`;
    if (key === 'dues') return `₹${stats.duesPendingAmount.toLocaleString('en-IN')}`;
    if (key === 'complaints') return stats.openComplaints;
    return stats.todaysVisitors;
  };

  if (!buildingId) return null;
  if (initialLoading && !stats) {
    return (
      <AdminLayout buildingId={buildingId} title="Dashboard" error={error} loading skeletonVariant="dashboard" />
    );
  }

  if (!stats) {
    return (
      <AdminLayout buildingId={buildingId} title="Dashboard" error={error}>
        <p style={ui.meta}>Unable to load dashboard.</p>
        <button type="button" style={retryBtn} onClick={() => { setInitialLoading(true); load(); }}>
          Retry
        </button>
      </AdminLayout>
    );
  }

  const activeMeta = TILES.find((t) => t.key === activeTile);
  const building = stats.building;

  return (
    <AdminLayout buildingId={buildingId} title="Good morning, Admin" error={error}>

      {building && (
        <div className="admin-code-banner" style={codeBanner}>
          <div>
            <div style={codeLabel}>Building code</div>
            <div className="admin-code-value" style={codeValue}>{building.buildingCode}</div>
          </div>
          <div style={codeMeta}>
            <div style={codeName}>{building.name}</div>
            {(building.city || building.address) && (
              <div style={ui.meta}>{building.city || building.address}</div>
            )}
            <div style={ui.meta}>Share this code with residents when they sign up</div>
          </div>
        </div>
      )}

      <div className={gridClass.stat} style={ui.statGrid}>
        {TILES.map(({ key, label }) => (
          <StatCard key={key} label={label} value={tileValue(key)} onClick={() => openTile(key)} />
        ))}
      </div>

      {activeTile && activeMeta && (
        <StatDetailPanel title={activeMeta.detailTitle} onClose={closeTile} loading={detailLoading}>
          {activeTile === 'flats' && detailData?.flats && <FlatsDetail flats={detailData.flats} buildingId={buildingId} />}
          {activeTile === 'dues' && detailData?.bills && (
            <DuesDetail bills={detailData.bills} buildingId={buildingId} onBillCleared={refreshDuesDetail} />
          )}
          {activeTile === 'complaints' && detailData?.complaints && <ComplaintsDetail complaints={detailData.complaints} buildingId={buildingId} />}
          {activeTile === 'visitors' && detailData?.visitors && <VisitorsDetail visitors={detailData.visitors} buildingId={buildingId} />}
        </StatDetailPanel>
      )}

      <section style={{ marginTop: 40 }}>
        <h2 style={approvalsTitle}>
          Pending member approvals
          {approvals.length > 0 && <span style={countBadge}>{approvals.length}</span>}
        </h2>
        {approvals.length === 0 ? (
          <p style={ui.meta}>No pending signups right now.</p>
        ) : (
          approvals.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              loading={loading}
              onApprove={(id) => decide(id, 'approved')}
              onReject={(id) => decide(id, 'rejected')}
            />
          ))
        )}
      </section>
    </AdminLayout>
  );
}

function FlatsDetail({ flats, buildingId }) {
  const occupied = flats.filter((f) => f.occupied);
  const vacant = flats.filter((f) => !f.occupied);

  return (
    <>
      <p style={summary}>{occupied.length} occupied · {vacant.length} vacant</p>
      {occupied.length === 0 ? (
        <EmptyDetail text="No flats occupied yet." />
      ) : (
        occupied.map((f) => (
          <DetailRow key={f.id}>
            <div>
              <strong>{f.number}</strong>
              <div style={ui.meta}>{displayTowerName(f.wing)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {f.residents.map((r) => (
                <div key={r.phone}>
                  <div>{r.name}</div>
                  <div style={ui.meta}>{r.phone}</div>
                </div>
              ))}
            </div>
          </DetailRow>
        ))
      )}
      {vacant.length > 0 && (
        <>
          <h4 style={vacantHeading}>Vacant flats</h4>
          <p style={vacantList}>{vacant.map((f) => f.number).join(', ')}</p>
        </>
      )}
    </>
  );
}

function DuesDetail({ bills, buildingId, onBillCleared }) {
  const [clearingId, setClearingId] = useState(null);

  if (bills.length === 0) return <EmptyDetail text="No pending dues." />;

  const byFlat = bills.reduce((acc, bill) => {
    const flatNumber = bill.flat?.number || 'Unassigned';
    const remaining = bill.remaining != null
      ? Number(bill.remaining)
      : Math.max(0, Number(bill.amount) - Number(bill.amountPaid || 0));
    if (!acc[flatNumber]) {
      acc[flatNumber] = { flatNumber, bills: [], total: 0 };
    }
    acc[flatNumber].bills.push({ ...bill, remaining });
    acc[flatNumber].total += remaining;
    return acc;
  }, {});

  const flatGroups = Object.values(byFlat).sort((a, b) =>
    a.flatNumber.localeCompare(b.flatNumber, undefined, { numeric: true })
  );

  const markPaid = async (billId) => {
    const confirmed = await showConfirm(
      'Mark this bill as paid and clear the due?',
      { title: 'Mark bill as paid', confirmLabel: 'Mark paid', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;
    setClearingId(billId);
    try {
      await api.markBillPaid(buildingId, billId);
      await onBillCleared();
    } catch (e) {
      await showError(e.message);
    } finally {
      setClearingId(null);
    }
  };

  return (
    <>
      <p style={summary}>
        {flatGroups.length} flat{flatGroups.length !== 1 ? 's' : ''} with pending dues · {bills.length} bill{bills.length !== 1 ? 's' : ''}
      </p>
      <div style={duesGrid}>
        {flatGroups.map((group) => (
          <div key={group.flatNumber} style={duesTile}>
            <div className="admin-dues-tile-header" style={duesTileHeader}>
              <strong style={duesFlat}>Flat {group.flatNumber}</strong>
              <span style={duesTotal}>₹{group.total.toLocaleString('en-IN')}</span>
            </div>
            {group.bills.map((bill) => (
              <div key={bill.id} className="admin-dues-bill-row" style={duesBillRow}>
                <div>
                  <div style={duesMonth}>{bill.month}</div>
                  <div style={ui.meta}>
                    ₹{(bill.remaining ?? bill.amount).toLocaleString('en-IN')} remaining
                    {bill.amountPaid > 0 ? ` of ₹${bill.amount.toLocaleString('en-IN')}` : ''}
                    {' · '}Due {new Date(bill.dueDate).toLocaleDateString('en-IN')}
                    {bill.type && bill.type !== 'maintenance' ? ` · ${bill.title || bill.type}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  style={clearBtn}
                  disabled={clearingId === bill.id}
                  onClick={() => markPaid(bill.id)}
                >
                  {clearingId === bill.id ? 'Clearing…' : 'Mark paid'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <ViewAllLink href={`/dashboard/${buildingId}/maintenance`}>Open Finance →</ViewAllLink>
    </>
  );
}

function ComplaintsDetail({ complaints, buildingId }) {
  if (complaints.length === 0) return <EmptyDetail text="No open complaints." />;
  return (
    <>
      {complaints.map((c) => (
        <DetailRow key={c.id}>
          <div>
            <strong>{c.title || c.category}</strong>
            <div style={ui.meta}>
              {c.user?.name}
              {c.flatNumber && <> · Flat {c.flatNumber}</>}
              {' · '}{c.category}
            </div>
            {c.description && <div style={desc}>{c.description}</div>}
            {c.imageUrl && (
              <img src={mediaUrl(c.imageUrl)} alt="" style={{ marginTop: 8, maxWidth: 120, maxHeight: 80, borderRadius: 6, objectFit: 'cover' }} />
            )}
          </div>
          <span style={ui.tag}>{c.status.replace('_', ' ')}</span>
        </DetailRow>
      ))}
      <ViewAllLink href={`/dashboard/${buildingId}/complaints`}>View all complaints →</ViewAllLink>
    </>
  );
}

function VisitorsDetail({ visitors, buildingId }) {
  if (visitors.length === 0) return <EmptyDetail text="No visitors logged today." />;
  return (
    <>
      {visitors.map((v) => (
        <DetailRow key={v.id}>
          <div>
            <strong>{v.visitorName}</strong>
            <div style={ui.meta}>
              {v.flat?.number ? `Visiting Flat ${v.flat.number}` : 'No flat specified'} · {v.purpose}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={ui.meta}>{new Date(v.entryTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <span style={ui.tag}>{v.status}</span>
          </div>
        </DetailRow>
      ))}
      <ViewAllLink href={`/dashboard/${buildingId}/visitors`}>View all visitors →</ViewAllLink>
    </>
  );
}

function StatCard({ label, value, onClick }) {
  return (
    <button type="button" className="stat-card-btn" style={statCard} onClick={onClick}>
      <p style={cardLabel}>{label}</p>
      <p style={cardValue}>{value}</p>
      <p style={cardHint}>Click for details</p>
    </button>
  );
}

function DetailRow({ children }) {
  return <div className="admin-detail-row" style={detailRow}>{children}</div>;
}

function EmptyDetail({ text }) {
  return <p style={emptyDetail}>{text}</p>;
}

function ViewAllLink({ href, children }) {
  return (
    <Link href={href} style={viewAll}>{children}</Link>
  );
}

const approvalsTitle = { ...ui.sectionTitle, display: 'flex', alignItems: 'center', gap: 8 };
const countBadge = { background: '#B4483A', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 10 };
const codeBanner = {
  display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
  background: '#fff', border: '1px solid #E2E5E4', borderRadius: 14,
  padding: '18px 22px', marginBottom: 24
};
const codeLabel = { fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 };
const codeValue = {
  fontWeight: 700, color: '#2B3A4A', marginTop: 4,
  letterSpacing: '0.08em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
};
const codeMeta = { flex: 1, minWidth: 180 };
const codeName = { fontSize: 16, fontWeight: 600, color: '#2B3A4A' };
const retryBtn = {
  marginTop: 12, border: '1px solid #E2E5E4', background: '#fff', color: '#2B3A4A',
  borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600
};
const statCard = { ...ui.statCard, transition: 'box-shadow 0.15s, border-color 0.15s' };
const cardLabel = { ...ui.meta, margin: 0 };
const cardValue = { fontSize: 26, fontWeight: 700, color: '#2B3A4A', margin: '4px 0 0', wordBreak: 'break-word' };
const cardHint = { color: '#9CA3AF', fontSize: 11, margin: '8px 0 0' };
const summary = { ...ui.meta, marginTop: 0, marginBottom: 16 };
const detailRow = {
  gap: 16,
  padding: '14px 0', borderBottom: '1px solid #F0F0F0'
};
const desc = { fontSize: 13, color: '#374151', marginTop: 6 };
const vacantHeading = { ...ui.sectionLabel, margin: '20px 0 8px', textTransform: 'none', letterSpacing: 'normal' };
const vacantList = { ...ui.meta, lineHeight: 1.6, margin: 0 };
const duesGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 };
const duesTile = {
  border: '1px solid #E2E5E4', borderRadius: 12, padding: 14, background: '#FAFAFA'
};
const duesTileHeader = {
  marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #E2E5E4'
};
const duesFlat = { fontSize: 15, color: '#2B3A4A' };
const duesTotal = { fontSize: 15, fontWeight: 700, color: '#B4483A' };
const duesBillRow = {
  gap: 10,
  padding: '8px 0', borderBottom: '1px solid #F0F0F0'
};
const duesMonth = { fontWeight: 600, fontSize: 14, color: '#374151' };
const clearBtn = {
  border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600,
  background: '#E8F0E9', color: '#2B5A3A', cursor: 'pointer', whiteSpace: 'nowrap'
};
const viewAll = { display: 'inline-block', marginTop: 16, color: '#2B3A4A', fontSize: 14, fontWeight: 600, textDecoration: 'none' };
const emptyDetail = { ...ui.meta, textAlign: 'center', padding: '24px 0' };
