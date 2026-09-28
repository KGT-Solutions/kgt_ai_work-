import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import DocumentManager from '../../components/workspace/DocumentManager';
import { PageHeader } from '../../components/ui';

export default function DocumentsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Documents" description="Everything your bots know. Upload files, write entries, or import pages from your website." />
      <DocumentManager ws={ws} audience="client" />
    </>
  );
}
DocumentsPage.getLayout = clientLayout;
