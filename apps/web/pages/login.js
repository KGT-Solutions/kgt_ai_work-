import Link from 'next/link';
import AuthShell from '../components/auth/AuthShell';
import SignInForm from '../components/auth/SignInForm';
import { api } from '../lib/api';

// Client company sign-in → its own dashboard.
export default function ClientLogin() {
  return (
    <AuthShell title="Sign in" heading="Welcome back" subheading="Sign in to manage your Support and Sales bots."
      footer={<>New to KGT AI Hub? <Link href="/register" className="font-medium text-cyan-300 hover:text-cyan-200">Create your bots</Link></>}>
      <SignInForm kind="client" signIn={api.clientLogin} checkSession={api.clientMe} destination="/dashboard" forgotHref="/forgot-password" />
    </AuthShell>
  );
}
