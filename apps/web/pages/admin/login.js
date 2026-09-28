import SignInCard from '../../components/SignInCard';
import { api } from '../../lib/api';

// KGT staff only. Staff accounts are created by the API's seed / reset
// scripts (HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD); client accounts can't sign
// in here — the API rejects their credentials and their tokens on staff routes.
export default function StaffLogin() {
  return (
    <SignInCard
      kind="operator"
      title="KGT AI Hub · Staff"
      tagline="Master control for every client company"
      signIn={api.staffLogin}
      checkSession={api.staffMe}
      destination="/admin"
      footer={<>Not KGT staff? <a href="/login">Client sign in</a></>}
    />
  );
}
