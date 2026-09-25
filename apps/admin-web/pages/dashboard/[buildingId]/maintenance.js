import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import ImageUploadField from '../../../components/ImageUploadField';
import { ui, gridClass } from '../../../components/ui';
import { api, mediaUrl } from '../../../lib/api';

const TABS = [
  { key: 'setup', label: 'Maintenance setup' },
  { key: 'collections', label: 'Collections' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'fund', label: 'Fund register' },
  { key: 'ledger', label: 'Ledger' }
];

export default function FinancePage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [tab, setTab] = useState('setup');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [config, setConfig] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [fund, setFund] = useState(null);
  const [flats, setFlats] = useState([]);
  const [wings, setWings] = useState([]);
  const [bills, setBills] = useState([]);
  const [paymentReviews, setPaymentReviews] = useState([]);

  // Guards against a stale response overwriting newer data if two load()s
  // ever end up in flight and resolve out of order.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!buildingId) return;
    const seq = ++loadSeq.current;
    setError('');
    try {
      const [cfg, acc, exp, fundSummary, flatList, wingList, billList, reviewsResult] = await Promise.all([
        api.getMaintenanceConfig(buildingId),
        api.getFlatAccounts(buildingId),
        api.getSocietyExpenses(buildingId),
        api.getFundSummary(buildingId),
        api.getFlats(buildingId),
        api.getWings(buildingId),
        api.getBills(buildingId),
        // A real failure here (500, auth) must not look identical to "no
        // payments pending" — the Collections tab is money-adjacent and an
        // admin needs to know reviews failed to load, not see an empty tab.
        api.getPaymentReviews(buildingId).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))
      ]);
      if (seq !== loadSeq.current) return; // a newer load already superseded this one
      setConfig(cfg);
      setAccounts(acc);
      setExpenses(exp);
      setFund(fundSummary);
      setFlats(flatList);
      setWings(wingList);
      setBills(billList);
      setPaymentReviews(reviewsResult.ok ? reviewsResult.r : []);
      if (!reviewsResult.ok) setError(`Payment reviews failed to load: ${reviewsResult.e.message}`);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e.message);
    }
  }, [buildingId]);

  useEffect(() => { load(); }, [load]);

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Finance" error={error} success={success}>

      <div style={tabRow}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            style={tab === t.key ? tabActive : tabIdle}
            onClick={() => { setTab(t.key); setSuccess(''); setError(''); }}
          >
            {t.label}
            {t.key === 'collections' && paymentReviews.length > 0
              ? ` (${paymentReviews.length})`
              : ''}
          </button>
        ))}
      </div>

      {tab === 'setup' && (
        <SetupTab
          buildingId={buildingId}
          config={config}
          bills={bills}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={load}
        />
      )}
      {tab === 'collections' && (
        <CollectionsTab
          buildingId={buildingId}
          accounts={accounts}
          paymentReviews={paymentReviews}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={load}
        />
      )}
      {tab === 'expenses' && (
        <ExpensesTab
          buildingId={buildingId}
          expenses={expenses}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={load}
        />
      )}
      {tab === 'fund' && fund && <FundTab fund={fund} />}
      {tab === 'ledger' && (
        <LedgerTab
          buildingId={buildingId}
          accounts={accounts}
          setError={setError}
        />
      )}
    </AdminLayout>
  );
}

function SetupTab({ buildingId, config, bills, loading, setLoading, setError, setSuccess, onSaved }) {
  const [amount, setAmount] = useState('');
  const [amount1Bhk, setAmount1Bhk] = useState('');
  const [amount2Bhk, setAmount2Bhk] = useState('');
  const [amount3Bhk, setAmount3Bhk] = useState('');
  const [billingDay, setBillingDay] = useState('1');
  const [active, setActive] = useState(true);
  const [startMonth, setStartMonth] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [qrFile, setQrFile] = useState(null);
  const [imageError, setImageError] = useState('');
  const [qrSaving, setQrSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setAmount(String(config.amount ?? ''));
    setAmount1Bhk(config.amount1Bhk != null ? String(config.amount1Bhk) : '');
    setAmount2Bhk(config.amount2Bhk != null ? String(config.amount2Bhk) : '');
    setAmount3Bhk(config.amount3Bhk != null ? String(config.amount3Bhk) : '');
    setBillingDay(String(config.billingDay ?? 1));
    setActive(config.active !== false);
    setStartMonth(config.startMonth || '');
    setOpeningBalance(String(config.openingBalance ?? 0));
    setQrFile(null);
    setImageError('');
  }, [config]);

  const uploadQrNow = async (file) => {
    if (!file) {
      setQrFile(null);
      return;
    }
    const bid = Array.isArray(buildingId) ? buildingId[0] : buildingId;
    if (!bid) {
      setImageError('Building not ready — refresh and try again');
      setError('Building not ready — refresh and try again');
      return;
    }
    setQrFile(file);
    setImageError('');
    setQrSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.savePaymentQr(bid, file);
      if (!res?.qrImageUrl) {
        throw new Error('Upload succeeded but no QR URL was returned');
      }
      setSuccess('Society UPI / QR image saved. Residents will see it when they tap Pay.');
      setQrFile(null);
      await onSaved();
    } catch (err) {
      setImageError(err.message || 'Failed to upload QR image');
      setError(err.message || 'Failed to upload QR image');
    } finally {
      setQrSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!qrFile && !config?.qrImageUrl) {
      setImageError('Society UPI / QR image is required');
      setError('Society UPI / QR image is required — upload it in the box below');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setImageError('');
    try {
      if (qrFile) {
        await api.savePaymentQr(buildingId, qrFile);
      }
      await api.saveMaintenanceConfig(
        buildingId,
        {
          amount: Number(amount || 0),
          amount1Bhk: amount1Bhk === '' ? null : Number(amount1Bhk),
          amount2Bhk: amount2Bhk === '' ? null : Number(amount2Bhk),
          amount3Bhk: amount3Bhk === '' ? null : Number(amount3Bhk),
          billingDay: Number(billingDay || 1),
          active,
          startMonth: startMonth || null,
          openingBalance: Number(openingBalance || 0)
        }
      );
      setSuccess('Maintenance settings saved. Charges will auto-create on the billing day each month.');
      setQrFile(null);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateNow = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.generateMaintenance(buildingId);
      if (res.skipped) {
        setSuccess(res.reason || 'Nothing to generate');
      } else {
        setSuccess(`Created ${res.created?.length || 0} maintenance bill(s) for ${res.period}`);
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const counts = config?.bhkCounts || {};
  const recentCharges = useMemo(() => {
    const list = Array.isArray(bills) ? [...bills] : [];
    return list.sort((a, b) => {
      const aPaid = a.paidAt ? new Date(a.paidAt).getTime() : 0;
      const bPaid = b.paidAt ? new Date(b.paidAt).getTime() : 0;
      if (aPaid !== bPaid) return bPaid - aPaid;
      return new Date(b.dueDate || 0).getTime() - new Date(a.dueDate || 0).getTime();
    });
  }, [bills]);

  return (
    <>
      <form onSubmit={save} style={ui.form}>
        <p style={ui.formTitle}>Automated monthly maintenance</p>
        <p style={ui.hint}>
          Set a default rate and optional amounts by flat size (1 / 2 / 3 BHK).
          Flats with a size use that rate; others use the default. Vacant flats are skipped.
        </p>
        {config?.bhkCounts && (
          <p style={{ ...ui.hint, marginBottom: 12 }}>
            Flat mix: {counts['1bhk'] || 0} × 1 BHK · {counts['2bhk'] || 0} × 2 BHK · {counts['3bhk'] || 0} × 3 BHK
            {(counts.uncategorized || 0) > 0 ? ` · ${counts.uncategorized} uncategorized` : ''}
          </p>
        )}
        <div className={gridClass.manage} style={{ gap: 12 }}>
          <div>
            <label style={label}>Default monthly amount (₹)</label>
            <input style={ui.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
          </div>
          <div>
            <label style={label}>1 BHK amount (₹)</label>
            <input
              style={ui.input}
              value={amount1Bhk}
              onChange={(e) => setAmount1Bhk(e.target.value)}
              inputMode="decimal"
              placeholder="Same as default if blank"
            />
          </div>
          <div>
            <label style={label}>2 BHK amount (₹)</label>
            <input
              style={ui.input}
              value={amount2Bhk}
              onChange={(e) => setAmount2Bhk(e.target.value)}
              inputMode="decimal"
              placeholder="Same as default if blank"
            />
          </div>
          <div>
            <label style={label}>3 BHK amount (₹)</label>
            <input
              style={ui.input}
              value={amount3Bhk}
              onChange={(e) => setAmount3Bhk(e.target.value)}
              inputMode="decimal"
              placeholder="Same as default if blank"
            />
          </div>
          <div>
            <label style={label}>Billing day (1–28)</label>
            <input style={ui.input} value={billingDay} onChange={(e) => setBillingDay(e.target.value)} inputMode="numeric" required />
          </div>
          <div>
            <label style={label}>Start month (optional)</label>
            <input style={ui.input} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} placeholder="2026-07" />
          </div>
          <div>
            <label style={label}>Fund opening balance (₹)</label>
            <input style={ui.input} value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} inputMode="decimal" />
          </div>
        </div>
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Auto-generate on billing day
        </label>
        <ImageUploadField
          title="Society UPI / QR image"
          required
          size="compact"
          existingUrl={config?.qrImageUrl}
          file={qrFile}
          setFile={uploadQrNow}
          error={imageError || (qrSaving ? 'Uploading…' : '')}
        />
        <p style={{ ...ui.hint, marginTop: 6 }}>
          Upload here to show this QR when residents tap Pay on My bills.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="submit"
            style={ui.btnAccent}
            disabled={loading || qrSaving || (!qrFile && !config?.qrImageUrl)}
          >
            {loading ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" style={ui.btnSecondary} onClick={generateNow} disabled={loading || qrSaving}>
            Generate this month now
          </button>
        </div>
      </form>

      <h3 style={{ ...ui.formTitle, marginTop: 28 }}>Recent charges</h3>
      <p style={ui.hint}>Paid bills and resident payment screenshots appear first.</p>
      {recentCharges.length === 0 ? (
        <div style={ui.empty}>No bills yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Flat</th>
                <th style={th}>Period</th>
                <th style={th}>Type</th>
                <th style={th}>Amount</th>
                <th style={th}>Paid</th>
                <th style={th}>Proof</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentCharges.slice(0, 50).map((b) => (
                <tr key={b.id}>
                  <td style={td}>{b.flat?.number || '—'}</td>
                  <td style={td}>{b.month}</td>
                  <td style={td}>{b.type || 'maintenance'}{b.title ? ` · ${b.title}` : ''}</td>
                  <td style={td}>₹{Number(b.amount).toLocaleString('en-IN')}</td>
                  <td style={td}>₹{Number(b.amountPaid || 0).toLocaleString('en-IN')}</td>
                  <td style={td}>
                    {b.receiptUrl ? (
                      <a href={mediaUrl(b.receiptUrl)} target="_blank" rel="noreferrer">
                        <img src={mediaUrl(b.receiptUrl)} alt="Payment proof" style={thumbImg} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={td}>
                    {b.status}
                    {b.paidMethod ? ` · ${b.paidMethod}` : ''}
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

function CollectionsTab({
  buildingId,
  accounts,
  paymentReviews = [],
  loading,
  setLoading,
  setError,
  setSuccess,
  onSaved
}) {
  const [flatId, setFlatId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [imageError, setImageError] = useState('');

  const dueAccounts = useMemo(() => accounts.filter((a) => a.dueBalance > 0), [accounts]);
  const advanceAccounts = useMemo(() => accounts.filter((a) => a.advanceBalance > 0), [accounts]);

  const reviewAction = async (paymentId, action) => {
    // disabled={loading} on the Approve/Reject buttons only takes effect
    // after React's next render, so a fast double-click can otherwise fire
    // two review calls on the same payment before the buttons visually
    // disable.
    if (loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      if (action === 'approve') {
        await api.approvePaymentReview(buildingId, paymentId);
        setSuccess('Payment approved — ledger and charges updated.');
      } else {
        await api.rejectPaymentReview(buildingId, paymentId);
        setSuccess('Payment rejected. Resident can submit again.');
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const record = async (e) => {
    e.preventDefault();
    if (!receiptFile) {
      setImageError('Payment screenshot / receipt image is required');
      setError('Payment screenshot / receipt image is required');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setImageError('');
    try {
      const res = await api.recordFinancePayment(
        buildingId,
        {
          flatId,
          amount: Number(amount),
          method,
          note: note || null
        },
        receiptFile
      );
      const adv = res.account?.advanceBalance || 0;
      const due = res.account?.dueBalance || 0;
      setSuccess(
        `Payment recorded. Due ₹${due.toLocaleString('en-IN')}` +
        (adv > 0 ? ` · Advance ₹${adv.toLocaleString('en-IN')}` : '')
      );
      setAmount('');
      setNote('');
      setReceiptFile(null);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={ui.form}>
        <p style={ui.formTitle}>
          Resident payments to review
          {paymentReviews.length > 0 ? ` (${paymentReviews.length})` : ''}
        </p>
        <p style={ui.hint}>
          Approve to post into the ledger and Recent charges. Reject to leave the bill unpaid.
        </p>
        {paymentReviews.length === 0 ? (
          <div style={ui.empty}>No payments waiting for review.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Submitted</th>
                  <th style={th}>Flat</th>
                  <th style={th}>Bill</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Proof</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paymentReviews.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>
                      {new Date(p.paidAt).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td style={td}>{p.flat?.number || '—'}</td>
                    <td style={td}>
                      {p.bill?.title || p.bill?.month || '—'}
                    </td>
                    <td style={td}>₹{Number(p.amount).toLocaleString('en-IN')}</td>
                    <td style={td}>
                      {p.receiptUrl ? (
                        <a href={mediaUrl(p.receiptUrl)} target="_blank" rel="noreferrer">
                          <img src={mediaUrl(p.receiptUrl)} alt="Proof" style={thumbImg} />
                        </a>
                      ) : '—'}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={linkBtn}
                          disabled={loading}
                          onClick={() => reviewAction(p.id, 'approve')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          style={{ ...linkBtn, color: '#B4483A' }}
                          disabled={loading}
                          onClick={() => reviewAction(p.id, 'reject')}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={record} style={ui.form}>
        <p style={ui.formTitle}>Record payment / lump sum</p>
        <p style={ui.hint}>
          Applies to oldest open charges first. Extra amount is kept as advance for that flat.
          Admin-recorded payments are applied immediately (no review).
        </p>
        <div className={gridClass.manage} style={{ gap: 12 }}>
          <div>
            <label style={label}>Flat</label>
            <select style={ui.input} value={flatId} onChange={(e) => setFlatId(e.target.value)} required>
              <option value="">Select flat</option>
              {accounts.map((a) => (
                <option key={a.flatId} value={a.flatId}>
                  {a.flatNumber}
                  {a.residents[0] ? ` · ${a.residents[0].name}` : a.occupied ? '' : ' · Vacant'}
                  {a.dueBalance > 0 ? ` · Due ₹${a.dueBalance}` : ''}
                  {a.advanceBalance > 0 ? ` · Adv ₹${a.advanceBalance}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Amount (₹)</label>
            <input style={ui.input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
          </div>
          <div>
            <label style={label}>Method</label>
            <select style={ui.input} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="admin">Other / admin</option>
            </select>
          </div>
          <div>
            <label style={label}>Note</label>
            <input style={ui.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <ImageUploadField
          title="Payment screenshot / receipt"
          required
          file={receiptFile}
          setFile={(f) => {
            setReceiptFile(f);
            setImageError('');
          }}
          error={imageError}
        />
        <button
          type="submit"
          style={{ ...ui.btnAccent, marginTop: 14 }}
          disabled={loading || !flatId || !receiptFile}
        >
          {loading ? 'Saving…' : 'Record payment'}
        </button>
      </form>

      <div className={gridClass.stat} style={{ ...ui.statGrid, marginTop: 24 }}>
        <div style={statCard}>
          <div style={statLabel}>Flats with dues</div>
          <div style={statValue}>{dueAccounts.length}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Flats with advance</div>
          <div style={statValue}>{advanceAccounts.length}</div>
        </div>
      </div>

      <h3 style={{ ...ui.formTitle, marginTop: 24 }}>Flat balances</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Flat</th>
              <th style={th}>Resident</th>
              <th style={th}>Due</th>
              <th style={th}>Advance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.flatId}>
                <td style={td}>{a.flatNumber}</td>
                <td style={td}>{a.residents.map((r) => r.name).join(', ') || (a.occupied ? '—' : 'Vacant')}</td>
                <td style={{ ...td, color: a.dueBalance > 0 ? '#B4483A' : '#6B7280', fontWeight: a.dueBalance > 0 ? 600 : 400 }}>
                  ₹{a.dueBalance.toLocaleString('en-IN')}
                </td>
                <td style={{ ...td, color: a.advanceBalance > 0 ? '#2B5A3A' : '#6B7280', fontWeight: a.advanceBalance > 0 ? 600 : 400 }}>
                  ₹{a.advanceBalance.toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ExpensesTab({ buildingId, expenses, loading, setLoading, setError, setSuccess, onSaved }) {
  const [category, setCategory] = useState('Miscellaneous');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [billingMode, setBillingMode] = useState('fund'); // fund | occupied | all_flats
  const [remarks, setRemarks] = useState('');
  const [editing, setEditing] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imageError, setImageError] = useState('');

  const resetForm = () => {
    setCategory('Miscellaneous');
    setVendor('');
    setAmount('');
    setBillingMode('fund');
    setRemarks('');
    setEditing(null);
    setImageFile(null);
    setImageError('');
  };

  const startEdit = (e) => {
    setEditing(e);
    setCategory(e.category || 'Miscellaneous');
    setVendor(e.vendor || '');
    setAmount(String(e.amount ?? ''));
    setRemarks(e.remarks || '');
    setImageFile(null);
    setImageError('');
    if (e.mode === 'fund') setBillingMode('fund');
    else if (e.splitScope === 'all_flats') setBillingMode('all_flats');
    else setBillingMode('occupied');
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const hasImage = !!(imageFile || editing?.imageUrl);
    if (!hasImage) {
      setImageError('Invoice / proof image is required');
      setError('Invoice / proof image is required');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    setImageError('');
    try {
      if (editing) {
        const payload = {
          category,
          vendor: vendor || null,
          remarks: remarks || null
        };
        if (editing.canEditAmount !== false) {
          payload.amount = Number(amount);
        }
        await api.updateSocietyExpense(buildingId, editing.id, payload, imageFile);
        setSuccess('Expense updated.');
        resetForm();
      } else {
        const payload = {
          category,
          vendor: vendor || null,
          amount: Number(amount),
          remarks: remarks || null
        };
        if (billingMode === 'fund') {
          payload.mode = 'fund';
        } else {
          payload.mode = 'recoverable';
          payload.splitScope = billingMode === 'all_flats' ? 'all_flats' : 'all_occupied';
        }
        const res = await api.createSocietyExpense(buildingId, payload, imageFile);
        if (payload.mode === 'recoverable') {
          setSuccess(`Expense saved and split across ${res.splitCount} flat(s).`);
        } else {
          setSuccess('Fund expense recorded.');
        }
        setAmount('');
        setVendor('');
        setRemarks('');
        setImageFile(null);
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete expense “${e.category}” of ₹${Number(e.amount).toLocaleString('en-IN')}?`)) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.deleteSocietyExpense(buildingId, e.id);
      setSuccess('Expense deleted.');
      if (editing?.id === e.id) resetForm();
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} style={ui.form}>
        <p style={ui.formTitle}>{editing ? 'Edit society expense' : 'Add society expense'}</p>
        <p style={ui.hint}>
          Choose how this expense is handled: fund-only from the kitty, or split equally across occupied flats or all flats.
        </p>
        <div className={gridClass.manage} style={{ gap: 12 }}>
          <div>
            <label style={label}>Category</label>
            <select style={ui.input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {['Security', 'Housekeeping', 'Electricity (Common)', 'Common Water Pump', 'Lift Maintenance', 'Society Events', 'Miscellaneous'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Vendor / description</label>
            <input style={ui.input} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. fire extinguisher" />
          </div>
          <div>
            <label style={label}>Amount (₹)</label>
            <input
              style={ui.input}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              required
              disabled={editing && editing.canEditAmount === false}
            />
            {editing && editing.canEditAmount === false && (
              <p style={{ ...ui.hint, marginTop: 6 }}>Amount locked — some flats have already paid.</p>
            )}
          </div>
          <div>
            <label style={label}>Mode</label>
            <select
              style={ui.input}
              value={billingMode}
              onChange={(e) => setBillingMode(e.target.value)}
              disabled={!!editing}
            >
              <option value="occupied">Split to occupied flats only</option>
              <option value="all_flats">Split between all the flats</option>
              <option value="fund">Fund expense (not billed to flats)</option>
            </select>
            {editing && (
              <p style={{ ...ui.hint, marginTop: 6 }}>Mode cannot be changed after creation.</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={label}>Remarks</label>
          <input style={ui.input} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <ImageUploadField
          title="Invoice / proof image"
          required
          existingUrl={editing?.imageUrl}
          file={imageFile}
          setFile={(f) => {
            setImageFile(f);
            setImageError('');
          }}
          error={imageError}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            type="submit"
            style={ui.btnAccent}
            disabled={loading || (!imageFile && !editing?.imageUrl)}
          >
            {loading ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
          </button>
          {editing && (
            <button type="button" style={ui.btnSecondary} onClick={resetForm} disabled={loading}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <h3 style={{ ...ui.formTitle, marginTop: 28 }}>Expense history</h3>
      {expenses.length === 0 ? (
        <div style={ui.empty}>No expenses yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Category</th>
                <th style={th}>Vendor</th>
                <th style={th}>Amount</th>
                <th style={th}>Mode</th>
                <th style={th}>Image</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{new Date(e.paidAt).toLocaleDateString('en-IN')}</td>
                  <td style={td}>{e.category}</td>
                  <td style={td}>{e.vendor || '—'}</td>
                  <td style={td}>₹{Number(e.amount).toLocaleString('en-IN')}</td>
                  <td style={td}>
                    {e.modeLabel || e.mode}
                    {e.mode === 'recoverable' && e.bills?.length ? ` · ${e.bills.length} flats` : ''}
                  </td>
                  <td style={td}>
                    {e.imageUrl ? (
                      <a href={mediaUrl(e.imageUrl)} target="_blank" rel="noreferrer">
                        <img src={mediaUrl(e.imageUrl)} alt="" style={thumbImg} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" style={linkBtn} onClick={() => startEdit(e)} disabled={loading}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={{ ...linkBtn, color: e.canDelete === false ? '#9CA3AF' : '#B4483A' }}
                        onClick={() => remove(e)}
                        disabled={loading || e.canDelete === false}
                        title={e.canDelete === false ? 'Cannot delete after residents have paid' : 'Delete'}
                      >
                        Delete
                      </button>
                    </div>
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

function FundTab({ fund }) {
  return (
    <>
      <div className={gridClass.stat} style={ui.statGrid}>
        <div style={statCard}>
          <div style={statLabel}>Opening</div>
          <div style={statValue}>₹{fund.openingBalance.toLocaleString('en-IN')}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Collections</div>
          <div style={statValue}>₹{fund.totalCollection.toLocaleString('en-IN')}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Fund expenses</div>
          <div style={statValue}>₹{fund.totalExpenses.toLocaleString('en-IN')}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Closing balance</div>
          <div style={{ ...statValue, color: fund.closingBalance >= 0 ? '#2B5A3A' : '#B4483A' }}>
            ₹{fund.closingBalance.toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      <p style={{ ...ui.hint, marginTop: 8 }}>
        Resident dues outstanding: ₹{fund.totalDue.toLocaleString('en-IN')} ·
        Advances held: ₹{fund.totalAdvance.toLocaleString('en-IN')}
      </p>

      <h3 style={{ ...ui.formTitle, marginTop: 24 }}>Monthly register</h3>
      {fund.register.length === 0 ? (
        <div style={ui.empty}>No collection or expense activity yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Month</th>
                <th style={th}>Collection</th>
                <th style={th}>Expenses</th>
                <th style={th}>Net</th>
                <th style={th}>Closing</th>
              </tr>
            </thead>
            <tbody>
              {fund.register.map((r) => (
                <tr key={r.month}>
                  <td style={td}>{r.month}</td>
                  <td style={td}>₹{r.collection.toLocaleString('en-IN')}</td>
                  <td style={td}>₹{r.expenses.toLocaleString('en-IN')}</td>
                  <td style={{ ...td, color: r.net >= 0 ? '#2B5A3A' : '#B4483A' }}>₹{r.net.toLocaleString('en-IN')}</td>
                  <td style={td}>₹{r.closingBalance.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fund.duesFlats?.length > 0 && (
        <>
          <h3 style={{ ...ui.formTitle, marginTop: 28 }}>Flats with pending dues</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Flat</th>
                  <th style={th}>Resident</th>
                  <th style={th}>Due</th>
                </tr>
              </thead>
              <tbody>
                {fund.duesFlats.map((a) => (
                  <tr key={a.flatId}>
                    <td style={td}>{a.flatNumber}</td>
                    <td style={td}>{a.residents.map((r) => r.name).join(', ') || '—'}</td>
                    <td style={{ ...td, color: '#B4483A', fontWeight: 600 }}>₹{a.dueBalance.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(fund.qrImageUrl || fund.paymentAttachments?.length || fund.expenseAttachments?.length) ? (
        <>
          <h3 style={{ ...ui.formTitle, marginTop: 28 }}>Attached images</h3>
          <p style={ui.hint}>Read-only view of society QR and uploaded payment / expense proofs.</p>
          {fund.qrImageUrl ? (
            <div style={{ marginBottom: 16 }}>
              <div style={statLabel}>Society UPI / QR</div>
              <a href={mediaUrl(fund.qrImageUrl)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(fund.qrImageUrl)} alt="Society QR" style={imagePreview} />
              </a>
            </div>
          ) : null}
          {fund.paymentAttachments?.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...statLabel, marginBottom: 8 }}>Payment receipts</div>
              <div style={attachGrid}>
                {fund.paymentAttachments.map((p) => (
                  <a key={p.id} href={mediaUrl(p.receiptUrl)} target="_blank" rel="noreferrer" style={attachCard}>
                    <img src={mediaUrl(p.receiptUrl)} alt="" style={thumbImgLg} />
                    <span style={attachCaption}>
                      Flat {p.flat?.number || '—'} · ₹{Number(p.amount).toLocaleString('en-IN')}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {fund.expenseAttachments?.length > 0 ? (
            <div>
              <div style={{ ...statLabel, marginBottom: 8 }}>Expense proofs</div>
              <div style={attachGrid}>
                {fund.expenseAttachments.map((e) => (
                  <a key={e.id} href={mediaUrl(e.imageUrl)} target="_blank" rel="noreferrer" style={attachCard}>
                    <img src={mediaUrl(e.imageUrl)} alt="" style={thumbImgLg} />
                    <span style={attachCaption}>
                      {e.category} · ₹{Number(e.amount).toLocaleString('en-IN')}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function formatMoney(n) {
  const value = Number(n) || 0;
  return `₹${Math.abs(value).toLocaleString('en-IN')}`;
}

function formatBalanceLabel(netBalance) {
  const value = Number(netBalance) || 0;
  if (value > 0) return `${formatMoney(value)} Dr`;
  if (value < 0) return `${formatMoney(value)} Cr`;
  return '₹0';
}

function LedgerTab({ buildingId, accounts, setError }) {
  const [selectedFlatId, setSelectedFlatId] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const hay = [
        a.flatNumber,
        a.wing,
        ...(a.residents || []).map((r) => r.name),
        ...(a.residents || []).map((r) => r.phone)
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, query]);

  const openLedger = async (flatId) => {
    setSelectedFlatId(flatId);
    setLoadingLedger(true);
    setError('');
    try {
      setLedger(await api.getFlatLedger(buildingId, flatId));
    } catch (e) {
      setLedger(null);
      setError(e.message);
    } finally {
      setLoadingLedger(false);
    }
  };

  const closeLedger = () => {
    setSelectedFlatId(null);
    setLedger(null);
  };

  if (selectedFlatId) {
    return (
      <>
        <button type="button" style={backBtn} onClick={closeLedger}>
          ← All flats
        </button>

        {loadingLedger && <div style={ui.empty}>Loading ledger…</div>}

        {!loadingLedger && ledger && (
          <>
            <div style={ledgerHeader}>
              <div>
                <h2 style={{ ...ui.sectionTitle, marginBottom: 4 }}>
                  Flat {ledger.flatNumber}
                  {ledger.wing ? ` · ${ledger.wing}` : ''}
                </h2>
                <p style={ui.hint}>
                  {ledger.residents?.length
                    ? ledger.residents.map((r) => r.name).join(', ')
                    : 'No resident linked'}
                </p>
              </div>
              <div style={ledgerSummary}>
                <div style={miniStat}>
                  <div style={statLabel}>Total debit</div>
                  <div style={{ ...statValue, fontSize: 18 }}>{formatMoney(ledger.totalDebit)}</div>
                </div>
                <div style={miniStat}>
                  <div style={statLabel}>Total credit</div>
                  <div style={{ ...statValue, fontSize: 18 }}>{formatMoney(ledger.totalCredit)}</div>
                </div>
                <div style={miniStat}>
                  <div style={statLabel}>Balance</div>
                  <div style={{
                    ...statValue,
                    fontSize: 18,
                    color: ledger.netBalance > 0 ? '#B4483A' : ledger.netBalance < 0 ? '#2B5A3A' : '#2B3A4A'
                  }}>
                    {formatBalanceLabel(ledger.netBalance)}
                  </div>
                </div>
              </div>
            </div>

            <p style={{ ...ui.hint, marginBottom: 12 }}>
              Debit = charge to flat · Credit = payment received · Balance Dr = due · Cr = advance
            </p>

            {ledger.entries.length === 0 ? (
              <div style={ui.empty}>No charges or payments for this flat yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Date</th>
                      <th style={th}>Particulars</th>
                      <th style={th}>Proof</th>
                      <th style={{ ...th, textAlign: 'right' }}>Debit (₹)</th>
                      <th style={{ ...th, textAlign: 'right' }}>Credit (₹)</th>
                      <th style={{ ...th, textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.entries.map((e) => (
                      <tr key={e.id}>
                        <td style={td}>
                          {new Date(e.date).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric'
                          })}
                        </td>
                        <td style={td}>{e.reason}</td>
                        <td style={td}>
                          {e.meta?.receiptUrl ? (
                            <a href={mediaUrl(e.meta.receiptUrl)} target="_blank" rel="noreferrer">
                              <img src={mediaUrl(e.meta.receiptUrl)} alt="" style={thumbImg} />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: e.debit ? '#B4483A' : '#9CA3AF' }}>
                          {e.debit != null ? e.debit.toLocaleString('en-IN') : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: e.credit ? '#2B5A3A' : '#9CA3AF' }}>
                          {e.credit != null ? e.credit.toLocaleString('en-IN') : '—'}
                        </td>
                        <td style={{
                          ...td,
                          textAlign: 'right',
                          fontWeight: 600,
                          color: e.balance > 0 ? '#B4483A' : e.balance < 0 ? '#2B5A3A' : '#2B3A4A'
                        }}>
                          {formatBalanceLabel(e.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Closing</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {ledger.totalDebit.toLocaleString('en-IN')}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {ledger.totalCredit.toLocaleString('en-IN')}
                      </td>
                      <td style={{
                        ...td,
                        textAlign: 'right',
                        fontWeight: 700,
                        color: ledger.netBalance > 0 ? '#B4483A' : ledger.netBalance < 0 ? '#2B5A3A' : '#2B3A4A'
                      }}>
                        {formatBalanceLabel(ledger.netBalance)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <p style={ui.hint}>
        Click a flat’s balance to open its full credit / debit ledger.
      </p>
      <div style={{ maxWidth: 320, marginBottom: 16 }}>
        <label style={label}>Search flat / resident</label>
        <input
          style={ui.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. B-402 or Asha"
        />
      </div>

      {filtered.length === 0 ? (
        <div style={ui.empty}>No flats match your search.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Flat</th>
                <th style={th}>Resident</th>
                <th style={th}>Due</th>
                <th style={th}>Advance</th>
                <th style={{ ...th, textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const net = a.netBalance != null
                  ? a.netBalance
                  : roundNet(a.dueBalance, a.advanceBalance);
                return (
                  <tr key={a.flatId}>
                    <td style={td}>
                      {a.flatNumber}
                      {a.wing ? <span style={{ color: '#9CA3AF' }}> · {a.wing}</span> : null}
                    </td>
                    <td style={td}>
                      {a.residents.map((r) => r.name).join(', ') || (a.occupied ? '—' : 'Vacant')}
                    </td>
                    <td style={{ ...td, color: a.dueBalance > 0 ? '#B4483A' : '#6B7280' }}>
                      ₹{a.dueBalance.toLocaleString('en-IN')}
                    </td>
                    <td style={{ ...td, color: a.advanceBalance > 0 ? '#2B5A3A' : '#6B7280' }}>
                      ₹{a.advanceBalance.toLocaleString('en-IN')}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        type="button"
                        style={{
                          ...balanceLink,
                          color: net > 0 ? '#B4483A' : net < 0 ? '#2B5A3A' : '#2B3A4A'
                        }}
                        onClick={() => openLedger(a.flatId)}
                      >
                        {formatBalanceLabel(net)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function roundNet(due, advance) {
  return Math.round((Number(due || 0) - Number(advance || 0)) * 100) / 100;
}

const label = { display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 6, fontWeight: 600 };
const tabRow = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 };
const tabActive = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #6B8F71',
  background: '#EEF4EF', color: '#2B5A3A', fontWeight: 600, cursor: 'pointer'
};
const tabIdle = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E5E4',
  background: '#fff', color: '#6B7280', cursor: 'pointer'
};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th = { textAlign: 'left', padding: '10px 8px', borderBottom: '2px solid #E2E5E4', color: '#6B7280', fontSize: 12 };
const td = { padding: '10px 8px', borderBottom: '1px solid #F0F0F0', color: '#2B3A4A' };
const statCard = {
  background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #E2E5E4'
};
const statLabel = { fontSize: 12, color: '#6B7280', fontWeight: 600, marginBottom: 6 };
const statValue = { fontSize: 22, fontWeight: 700, color: '#2B3A4A' };
const backBtn = {
  background: 'none', border: 'none', color: '#2B5A3A', fontWeight: 600,
  cursor: 'pointer', padding: 0, marginBottom: 16, fontSize: 14
};
const ledgerHeader = {
  display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
  alignItems: 'flex-start', marginBottom: 8
};
const ledgerSummary = { display: 'flex', gap: 12, flexWrap: 'wrap' };
const miniStat = {
  background: '#fff', borderRadius: 12, padding: '12px 16px', border: '1px solid #E2E5E4', minWidth: 120
};
const balanceLink = {
  background: 'none', border: 'none', padding: 0, fontWeight: 700, fontSize: 14,
  cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3
};
const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: '#3D6B8C', fontWeight: 600, fontSize: 13
};
const imagePreview = {
  maxWidth: 200, maxHeight: 200, borderRadius: 10,
  border: '1px solid #E2E5E4', objectFit: 'cover', display: 'block'
};
const thumbImg = {
  width: 40, height: 40, borderRadius: 6, objectFit: 'cover',
  border: '1px solid #E2E5E4', verticalAlign: 'middle'
};
const thumbImgLg = {
  width: '100%', height: 96, borderRadius: 8, objectFit: 'cover',
  border: '1px solid #E2E5E4', display: 'block'
};
const attachGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 12
};
const attachCard = {
  display: 'block', textDecoration: 'none', color: 'inherit'
};
const attachCaption = {
  display: 'block', marginTop: 6, fontSize: 12, color: '#6B7280', fontWeight: 600
};
