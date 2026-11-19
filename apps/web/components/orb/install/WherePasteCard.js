import { Card, Button } from '..';

// "Where to paste it" — short how-to sections + a support action.
// props: sections [{ title, body }], onEmailSupport
export default function WherePasteCard({ sections = [], onEmailSupport }) {
  return (
    <Card title="Where to paste it">
      <div className="flex flex-col gap-4">
        {sections.map((sec) => (
          <div key={sec.title}>
            <p className="orb-body-strong text-orb-ink">{sec.title}</p>
            <p className="mt-1 orb-small text-orb-secondary">{sec.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-5">
        <Button onClick={onEmailSupport}>Email KGT support</Button>
      </div>
    </Card>
  );
}
