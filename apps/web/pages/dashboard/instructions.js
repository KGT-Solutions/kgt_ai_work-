import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import InstructionsEditor from '../../components/workspace/InstructionsEditor';
import { PageHeader } from '../../components/ui';

export default function InstructionsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Instructions"
        description="Shape how each assistant sounds — tone, style, length and a little guidance. Your knowledge, prices and safety rules stay locked and always apply." />
      <InstructionsEditor ws={ws} />
    </>
  );
}
InstructionsPage.getLayout = clientLayout;
