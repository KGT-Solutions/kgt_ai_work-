import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import ApprovalCard from '../../../components/ApprovalCard';
import FamilyApprovalCard from '../../../components/FamilyApprovalCard';
import { ui } from '../../../components/ui';
import { api } from '../../../lib/api';

export default function ResidentsPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [approvals, setApprovals] = useState([]);
  const [familyApprovals, setFamilyApprovals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      const [residentList, familyList] = await Promise.all([
        api.getApprovals(buildingId),
        api.getFamilyApprovals(buildingId)
      ]);
      setApprovals(residentList);
      setFamilyApprovals(familyList);
      setError('');
    } catch (e) {
      setError(e.message);
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

  const decideFamily = async (memberId, status) => {
    setLoading(true);
    try {
      await api.reviewFamilyMember(buildingId, memberId, status);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Member approvals" error={error}>
      <p style={intro}>
        Review resident and guard signup requests. Family members are added directly by the flat master — you only get a notification.
      </p>

      <h2 style={sectionTitle}>Resident signups</h2>
      {approvals.length === 0 ? (
        <div style={ui.empty}>No pending resident signups.</div>
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

      {familyApprovals.length > 0 && (
        <>
          <h2 style={{ ...sectionTitle, marginTop: 32 }}>Legacy family requests</h2>
          <p style={{ ...ui.meta, marginBottom: 12 }}>
            Older requests still awaiting review. New family members no longer need admin approval.
          </p>
          {familyApprovals.map((m) => (
            <FamilyApprovalCard
              key={m.id}
              member={m}
              loading={loading}
              onApprove={(id) => decideFamily(id, 'approved')}
              onReject={(id) => decideFamily(id, 'rejected')}
            />
          ))}
        </>
      )}
    </AdminLayout>
  );
}

const intro = { ...ui.meta, marginTop: -12, marginBottom: 24, fontSize: 14 };
const sectionTitle = { ...ui.sectionTitle, fontSize: 18, marginBottom: 16 };
