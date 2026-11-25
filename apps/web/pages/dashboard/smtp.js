import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import SmtpSettings from '../../components/workspace/SmtpSettings';
import EmailConnections from '../../components/workspace/EmailConnections';
import { PageHeader } from '../../components/ui';

export default function SmtpPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Email settings"
        description="Send ticket alerts, lead emails and notifications from your own Google/Microsoft account or mail server instead of the platform default." />
      <div className="space-y-8">
        <EmailConnections ws={ws} />
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-2">Or use a custom SMTP server</h2>
          <SmtpSettings ws={ws} />
        </div>
      </div>
    </>
  );
}
SmtpPage.getLayout = clientLayout;
