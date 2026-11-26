import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import TicketsList from '../../components/workspace/TicketsList';
import EscalationSettings from '../../components/workspace/EscalationSettings';
import { PageHeader } from '../../components/ui';

export default function TicketsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Tickets" description="Questions your bots handed off instead of guessing." />
      <div className="space-y-5">
        <EscalationSettings ws={ws} />
        <TicketsList ws={ws} />
      </div>
    </>
  );
}
TicketsPage.getLayout = clientLayout;
