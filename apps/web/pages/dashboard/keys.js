import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import KeyVault from '../../components/workspace/KeyVault';
import { PageHeader } from '../../components/ui';

export default function KeysPage() {
  const { ws, tenant } = useSession();
  return (
    <>
      <PageHeader title="API keys" description="Keys let the embed widget talk to your bots. Each is shown once, then kept only as a fingerprint." />
      <KeyVault ws={ws} tenant={tenant} />
    </>
  );
}
KeysPage.getLayout = clientLayout;
