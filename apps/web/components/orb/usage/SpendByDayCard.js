import { Card, cx } from '..';

// "Spend by day" — a compact daily-spend bar chart (values on top, day labels
// below; the latest day is highlighted dark). Matches Figma 512:2024.
// props: range, data [{ x, value, highlight? }]
export default function SpendByDayCard({ range, data = [] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const last = data.length - 1;
  return (
    <Card
      title="Spend by day"
      headerRight={<span className="orb-small text-orb-tertiary">{range}</span>}
      className="self-stretch"
      bodyClassName="flex flex-col"
    >
      <div className="flex min-h-[200px] flex-1 items-end gap-5">
        {data.map((d, i) => {
          const highlight = d.highlight ?? i === last;
          return (
            <div key={d.x} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="orb-small-medium text-orb-ink">₹{d.value.toLocaleString('en-IN')}</span>
              <div
                className={cx('w-full rounded-t-[3px]', highlight ? 'bg-orb-ink' : 'bg-orb-light-grey')}
                style={{ height: `${(d.value / max) * 150}px` }}
              />
              <span className="orb-small text-orb-tertiary">{d.x}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
