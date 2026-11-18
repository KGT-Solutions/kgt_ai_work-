import { Card, CardExpandButton, RankedBarList } from '..';

// "What visitors ask" — ranked topics with share bars.
// props: items [{ label, pct, pill? }], onExpand
export default function WhatVisitorsAskCard({ items = [], onExpand }) {
  return (
    <Card title="What visitors ask" headerRight={<CardExpandButton onClick={onExpand} label="Expand What visitors ask" />}>
      <RankedBarList items={items} />
    </Card>
  );
}
