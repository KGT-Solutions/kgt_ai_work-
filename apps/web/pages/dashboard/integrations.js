import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import CrmIntegrations from '../../components/workspace/CrmIntegrations';
import { PageHeader } from '../../components/ui';

export default function IntegrationsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Integrations"
        description="Connect KGT AI Hub to the tools your team already uses. Captured leads flow out, and status changes flow back." />
      <CrmIntegrations ws={ws} />
    </>
  );
}
IntegrationsPage.getLayout = clientLayout;
