import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import BrandingStudio from '../../components/workspace/BrandingStudio';
import { PageHeader } from '../../components/ui';

export default function BrandingPage() {
  const { ws, tenant } = useSession();
  return (
    <>
      <PageHeader title="Bot branding & theme"
        description="Three chat widget designs built from your logo and brand colours. Apply one and it goes live on your website at once." />
      <BrandingStudio ws={ws} companyName={tenant?.name} />
    </>
  );
}
BrandingPage.getLayout = clientLayout;
