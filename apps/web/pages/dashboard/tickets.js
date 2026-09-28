import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import TicketsList from '../../components/workspace/TicketsList';
import { PageHeader } from '../../components/ui';

export default function TicketsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Tickets" description="Questions your bots handed off instead of guessing." />
      <TicketsList ws={ws} />
    </>
  );
}
TicketsPage.getLayout = clientLayout;
