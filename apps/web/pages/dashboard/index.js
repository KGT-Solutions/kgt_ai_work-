import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import Overview from '../../components/workspace/Overview';
import SignupWelcome from '../../components/workspace/SignupWelcome';
import { PageHeader } from '../../components/ui';

export default function DashboardOverview() {
  const { tenant, ws, name } = useSession();

  return (
    <>
      {/* Also rendered here as a fallback: the wizard lands on /dashboard/bots, but
          if a handoff is still around when the owner first opens the overview, the
          one-time key surfaces here too rather than being lost. */}
      <SignupWelcome tenant={tenant} />
      <PageHeader title={`Welcome back${name ? `, ${String(name).split(/[\s@]/)[0]}` : ''}`}
        description={`${tenant.name} · Support and Sales bots`} />
      <Overview ws={ws} tenant={tenant} base="/dashboard" />
    </>
  );
}
DashboardOverview.getLayout = clientLayout;
