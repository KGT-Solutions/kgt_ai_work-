import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import LeadsPanel from '../../components/workspace/LeadsPanel';
import { PageHeader } from '../../components/ui';

export default function LeadsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Leads & Summaries"
        description="Visitors who left their email in a chat, with an AI summary of each conversation so your team can follow up fast." />
      <LeadsPanel ws={ws} />
    </>
  );
}
LeadsPage.getLayout = clientLayout;
