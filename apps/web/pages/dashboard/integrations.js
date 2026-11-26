import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import CrmIntegrations from '../../components/workspace/CrmIntegrations';
import HubspotIntegration from '../../components/workspace/HubspotIntegration';
import HelpdeskIntegration from '../../components/workspace/HelpdeskIntegration';
import WebhooksPanel from '../../components/workspace/WebhooksPanel';
import GoogleSheetsSync from '../../components/workspace/GoogleSheetsSync';
import { PageHeader } from '../../components/ui';

export default function IntegrationsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Integrations"
        description="Connect KGT AI Hub to the tools your team already uses. Captured leads flow out, status changes flow back, escalations open helpdesk tickets, and events reach your own systems via webhooks or Google Sheets." />
      <div className="space-y-5">
        <CrmIntegrations ws={ws} />
        <HubspotIntegration ws={ws} />
        <HelpdeskIntegration ws={ws} />
        <GoogleSheetsSync ws={ws} />
        <WebhooksPanel ws={ws} />
      </div>
    </>
  );
}
IntegrationsPage.getLayout = clientLayout;
