import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import GuardrailsSettings from '../../components/workspace/GuardrailsSettings';
import { PageHeader } from '../../components/ui';

export default function GuardrailsPage() {
  const { ws } = useSession();
  return (
    <>
      <PageHeader title="Guardrails"
        description="Protect your bots and your budget: per-visitor rate limits, spam detection, country blocking, and visitor image uploads." />
      <GuardrailsSettings ws={ws} />
    </>
  );
}
GuardrailsPage.getLayout = clientLayout;
