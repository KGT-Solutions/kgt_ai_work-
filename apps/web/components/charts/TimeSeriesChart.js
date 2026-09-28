import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART_INK } from '../../lib/chartColors';

// Daily time series, one y-axis. 2px lines; a soft area under a single
// series; a legend + end labels when there are two (identity never by color
// alone). Hover/touch shows a crosshair and a tooltip with every series'
// value for that day. A table view carries the same numbers for screen
// readers and anyone who'd rather read than hover.
//
// data:   [{ date: 'YYYY-MM-DD', [key]: number, ... }]  oldest first
// series: [{ key, label, color }]  — colors from lib/chartColors.js, fixed order

const PAD = { top: 12, right: 16, bottom: 26, left: 40 };

function niceMax(v) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag * 4 >= v) * mag;
  return step * 4;
}

const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtNum = (n) => Number(n).toLocaleString('en-US');

export default function TimeSeriesChart({ data, series, height = 220, title, emptyText = 'No activity in this period yet.' }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null); // index into data
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = useMemo(() => data.reduce((acc, d) => acc + series.reduce((s, x) => s + (d[x.key] || 0), 0), 0), [data, series]);
  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)))), [data, series]);

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 72))));

  const pointerToIndex = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const rel = clientX - rect.left - PAD.left;
    return Math.max(0, Math.min(data.length - 1, Math.round((rel / innerW) * (data.length - 1))));
  };

  const single = series.length === 1;
  const last = data.length - 1;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {single ? <span /> : (
          <ul className="flex flex-wrap gap-4" aria-label="Legend">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs text-fg-2">
                <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />{s.label}
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setAsTable((t) => !t)} className="text-xs font-medium text-fg-3 hover:text-fg-2">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-[260px] overflow-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-panel-2 text-fg-3">
              <tr><th className="px-3 py-2 font-medium">Day</th>{series.map((s) => <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>)}</tr>
            </thead>
            <tbody className="tabular-nums text-fg-2">
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-white/[0.04]">
                  <td className="px-3 py-1.5">{fmtDay(d.date)}</td>
                  {series.map((s) => <td key={s.key} className="px-3 py-1.5 text-right">{fmtNum(d[s.key] || 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative select-none" style={{ height }}
          onPointerMove={(e) => data.length && setHover(pointerToIndex(e.clientX))}
          onPointerLeave={() => setHover(null)}>
          <svg width={width} height={height} role="img" aria-label={`${title}: ${fmtNum(total)} in total over ${data.length} days`}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={CHART_INK.grid} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10.5" fill={CHART_INK.axis} className="tabular-nums">
                  {fmtNum(Math.round(t))}
                </text>
              </g>
            ))}
            {data.map((d, i) => (i % labelEvery === 0 || i === last) && (i === last || last - i >= labelEvery / 2) ? (
              <text key={d.date} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize="10.5" fill={CHART_INK.axis}>
                {fmtDay(d.date)}
              </text>
            ) : null)}

            {series.map((s) => {
              const pts = data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`);
              return (
                <g key={s.key}>
                  {single && data.length > 1 && (
                    <path d={`M${x(0)},${y(0)} L${pts.join(' L')} L${x(last)},${y(0)} Z`} fill={`url(#area-${s.key})`} />
                  )}
                  <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {!single && data.length > 0 && (
                    <circle cx={x(last)} cy={y(data[last][s.key] || 0)} r="3.5" fill={s.color} stroke="#0E1117" strokeWidth="2" />
                  )}
                </g>
              );
            })}

            {hover !== null && data[hover] && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key] || 0)} r="4.5" fill={s.color} stroke="#0E1117" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>

          {total === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-fg-3">{emptyText}</p>
          )}

          {hover !== null && data[hover] && (
            <div className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-lg border border-white/10 bg-panel-3/95 px-3 py-2 text-xs shadow-card backdrop-blur"
              style={{ left: Math.min(Math.max(x(hover) - 70, 0), width - 150) }}>
              <p className="mb-1 font-medium text-fg">{fmtDay(data[hover].date)}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-fg-2">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                  <span className="tabular-nums text-fg">{fmtNum(data[hover][s.key] || 0)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
