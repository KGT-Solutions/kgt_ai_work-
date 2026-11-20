import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import BotSandbox from '../../components/workspace/BotSandbox';
import SignupWelcome from '../../components/workspace/SignupWelcome';
import { PageHeader } from '../../components/ui';

export default function BotsPage() {
  const { ws, tenant } = useSession();
  return (
    <>
      {/* The wizard lands new signups here; show their one-time API key + embed snippets. */}
      <SignupWelcome tenant={tenant} />
      <PageHeader title="Test bots" description="Ask both bots the same question and compare. Same engine and knowledge your website visitors get." />
      <BotSandbox ws={ws} tenant={tenant} />
    </>
  );
}
BotsPage.getLayout = clientLayout;
