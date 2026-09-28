import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import UsagePanel from '../../components/workspace/UsagePanel';
import { PageHeader } from '../../components/ui';

export default function UsagePage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Usage" description="Conversations, questions, AI answers and tokens over time." />
      <UsagePanel ws={ws} />
    </>
  );
}
UsagePage.getLayout = clientLayout;
