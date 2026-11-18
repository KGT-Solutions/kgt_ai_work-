import Head from 'next/head';
import { OrbLineChart, OrbBarChart, OrbGauge, ORB } from '../components/orb/charts';

// Isolated preview of the 3 reusable Orb chart components with sample data.
// Standalone route — visit /orb-charts. Hover the line/bar charts to see values.

const LINE_DATA = [
  { x: 'Wed', this: 24, last: 22 }, { x: 'Thu', this: 28, last: 24 },
  { x: 'Fri', this: 30, last: 26 }, { x: 'Sat', this: 35, last: 29 },
  { x: 'Sun', this: 26, last: 27 }, { x: 'Mon', this: 22, last: 24 },
  { x: 'Tue', this: 33, last: 27 }
];
const LINE_SERIES = [
  { key: 'this', label: 'This week', color: ORB.ink },
  { key: 'last', label: 'Last week', color: ORB.stroke, dashed: true }
];

const HOURS = ['12 am', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12 pm', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11 pm'];
const HOUR_VALS = [31, 20, 12, 7, 5, 8, 17, 29, 48, 66, 84, 87, 80, 74, 76, 73, 69, 71, 93, 102, 120, 153, 158, 147];
const BAR_DATA = HOURS.map((x, i) => ({ x, hour: i, value: HOUR_VALS[i] }));

function Card({ title, right, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-orb-hairline bg-orb-white p-7 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="orb-card-title text-orb-ink">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function OrbChartsPreview() {
  return (
    <>
      <Head><title>Orb charts preview</title></Head>
      <div className="orb-theme min-h-screen p-10">
        <h1 className="orb-page-title text-orb-ink">Chart components</h1>
        <p className="mt-2 orb-body text-orb-secondary">The 3 reusable Orb charts (Recharts, restyled). Hover the line and bar charts to see values.</p>

        <div className="mt-6 grid grid-cols-1 gap-7 lg:grid-cols-2">
          <Card title="Knowledge readiness">
            <div className="flex justify-center">
              <OrbGauge value={86} max={100} markerLabel="Ready 80" />
            </div>
          </Card>

          <Card title="When visitors talk to Orb">
            <OrbBarChart
              data={BAR_DATA}
              xKey="x"
              yKey="value"
              barName="conversations"
              height={240}
              colorFor={(d) => (d.hour >= 20 || d.hour < 9 ? ORB.ink : ORB.lightGrey)}
            />
          </Card>

          <Card title="Patient enquiries" className="lg:col-span-2">
            <OrbLineChart data={LINE_DATA} series={LINE_SERIES} xKey="x" height={260} />
          </Card>
        </div>
      </div>
    </>
  );
}
