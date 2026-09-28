import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { BarList, MiniLine, PageHeader, Panel, SectionTitle, StatCard } from '../ui.jsx';

const money = (v) => v == null ? 'N/A' : `₹${Math.round(v).toLocaleString('en-IN')}`;

export default function NationalIndex() {
  const [data, setData] = useState(null); const [history, setHistory] = useState([]); const [weekly, setWeekly] = useState(null); const [monthly, setMonthly] = useState(null); const [lastCollection, setLastCollection] = useState(null); const [error, setError] = useState(null);
  useEffect(() => { api.getIndex().then(setData).catch(e => setError(e.message)); api.getIndexHistory().then(h => setHistory(h.history || [])).catch(()=>{}); api.getIndexWeekly().then(setWeekly).catch(()=>{}); api.getIndexMonthly().then(setMonthly).catch(()=>{}); api.getCollectorStatus().then(s => setLastCollection(s.finished_at || null)).catch(()=>{}); }, []);
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="muted">Loading national index…</div>;
  if (data.status === 'INSUFFICIENT_DATA') return <><PageHeader title="National Index" subtitle="Weighted airfare price index across the 6-route basket" /><Panel><strong>INSUFFICIENT_DATA</strong><p className="muted">{data.message}</p></Panel></>;
  const routeBars = data.routes.map(r => ({ label: r.route, value: r.observation_count }));
  const histValues = history.map(h => h.index).filter(Boolean);
  const histLabels = history.map(h => new Date(h.current_period).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }));
  return <>
    <PageHeader kicker="APIx · National statistical analytics" title="National Index" subtitle="Weighted airfare price index across the 6-route basket" />
    <div className="kpi-grid">
      <StatCard label="National Index" value={data.index ?? 'N/A'} hint="Base = 100" tone="accent" />
      <StatCard label="Observations" value={data.observations} hint="All stored observations" />
      <StatCard label="Coverage" value={`${data.coverage}%`} hint="6 routes × 5 horizons" />
      <StatCard label="Base Period" value={new Date(data.base_period).toLocaleDateString('en-GB')} hint="Reference period" />
      <StatCard label="Latest Collection" value={lastCollection ? new Date(lastCollection).toLocaleDateString('en-GB') : 'N/A'} hint={lastCollection ? new Date(lastCollection).toLocaleTimeString() : 'Not available'} tone="gold" />
    </div>
    <Panel>
      <SectionTitle title="Route contributions" subtitle="Traffic-weighted corridor view" />
      <div className="table-shell"><table><thead><tr><th>Route</th><th>Weight</th><th>Base median</th><th>Current median</th><th>Relative index</th><th>Observations</th></tr></thead><tbody>{data.routes.map(r => <tr key={r.route}><td><strong>{r.route}</strong></td><td>{Math.round(r.weight*100)}%</td><td>{money(r.base_median)}</td><td>{money(r.current_median)}</td><td>{r.relative_index ?? 'N/A'}</td><td>{r.observation_count}</td></tr>)}</tbody></table></div>
    </Panel>
    <div className="three-grid">
      <Panel><SectionTitle title="APIx trend" subtitle="Recorded index history only" />{histValues.length > 1 ? <MiniLine values={histValues} labels={histLabels} ariaLabel="APIx recorded index trend" /> : <div className="chart-empty">Not enough recorded snapshots yet.</div>}</Panel>
      <Panel><SectionTitle title="Observation footprint" subtitle="Count by route" /><BarList items={routeBars} valueFormatter={(v)=>v} /></Panel>
      <Panel><SectionTitle title="Latest movement context" subtitle="Weekly / monthly aggregates" />
        <div className="detail-list">
          <div><span>Weekly</span><strong>{weekly?.periods?.[0]?.index_avg ?? '—'}</strong></div>
          <div><span>Monthly</span><strong>{monthly?.periods?.[0]?.index_avg ?? '—'}</strong></div>
          <div><span>Recorded days</span><strong>{history.length}</strong></div>
        </div>
      </Panel>
    </div>
  </>;
}
