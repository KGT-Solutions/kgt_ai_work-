import Link from 'next/link';
import AuthShell from '../../components/auth/AuthShell';
import SignInForm from '../../components/auth/SignInForm';
import { Badge } from '../../components/ui';
import { api } from '../../lib/api';

// KGT staff only. Staff accounts come from the API's seed / reset scripts
// (HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD); client accounts are refused here.
export default function StaffLogin() {
  return (
    <AuthShell title="Staff sign in" heading={<span className="inline-flex items-center gap-2">Staff console <Badge tone="violet">KGT only</Badge></span>}
      subheading="Master control for every client company."
      footer={<>Not KGT staff? <Link href="/login" className="font-medium text-cyan-300 hover:text-cyan-200">Client sign in</Link></>}>
      <SignInForm kind="operator" signIn={api.staffLogin} checkSession={api.staffMe} destination="/admin" />
    </AuthShell>
  );
}
