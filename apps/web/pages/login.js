import SignInCard from '../components/SignInCard';
import { api } from '../lib/api';

// Client company sign-in → its own dashboard. Accounts are created at the
// end of the signup wizard (/register).
export default function ClientLogin() {
  return (
    <SignInCard
      kind="client"
      title="KGT AI Hub"
      tagline="Sign in to manage your Support and Sales bots"
      signIn={api.clientLogin}
      checkSession={api.clientMe}
      destination="/dashboard"
      footer={<>New here? <a href="/register">Create your bots</a></>}
    />
  );
}
