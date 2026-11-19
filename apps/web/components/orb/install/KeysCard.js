import { Card, Button, IconKey } from '..';

// "Keys" — each snippet's key, with revoke. props: keys [{ id, label, keyMasked,
// made, lastUsed, revoked }], onMakeKey, onRevoke
const COLS = 'grid grid-cols-[1fr_170px_90px_140px_100px] items-center gap-3';

export default function KeysCard({ keys = [], onMakeKey, onRevoke }) {
  return (
    <Card
      title="Keys"
      subtitle="Each snippet carries a key. Revoke one and Orb stops on every page using it, straight away."
      headerRight={<Button onClick={onMakeKey}>Make a new key</Button>}
    >
      <div className="overflow-hidden rounded-xl border border-orb-hairline">
        <div className={`${COLS} bg-orb-subtle px-4 py-2.5`}>
          {['Label', 'Key', 'Made', 'Last used', ''].map((h, i) => <span key={i} className="orb-heading text-orb-secondary">{h}</span>)}
        </div>
        <ul className="divide-y divide-orb-hairline">
          {keys.map((k) => (
            <li key={k.id} className={`${COLS} px-4 py-3`}>
              <span className="flex min-w-0 items-center gap-2 text-orb-secondary">
                <IconKey size={16} />
                <span className="truncate orb-body-strong text-orb-ink">{k.label}</span>
              </span>
              <span className="orb-code text-orb-secondary">{k.keyMasked}</span>
              <span className="orb-body text-orb-secondary">{k.made}</span>
              <span className="orb-body text-orb-secondary">{k.lastUsed}</span>
              <span className="flex justify-end">
                {!k.revoked && <Button onClick={() => onRevoke?.(k)}>Revoke</Button>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
