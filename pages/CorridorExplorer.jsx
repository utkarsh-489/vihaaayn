import { useEffect, useState } from 'react';
import { api } from '../api';
import { MiniLine, PageHeader, Panel, RoutePill, SectionTitle, StatCard } from '../ui.jsx';

const money = (v)=>v==null?'N/A':`₹${Math.round(v).toLocaleString('en-IN')}`;
export default function CorridorExplorer(){
  const [corridors,setCorridors]=useState(null); const [selected,setSelected]=useState(null); const [error,setError]=useState(null);
  useEffect(()=>{api.getCorridors().then(d=>{setCorridors(d.corridors||[]); if(d.corridors?.length)setSelected(d.corridors[0].route)}).catch(e=>setError(e.message))},[]);
  if(error)return <div className="error-box">{error}</div>; if(!corridors)return <div className="muted">Loading corridor data…</div>;
  const route=corridors.find(c=>c.route===selected); const vals=route?.windows?.map(w=>w.median_fare).filter(v=>v!=null)||[]; const labels=route?.windows?.map(w=>w.window)||[];
  return <>
    <PageHeader kicker="Route analytics" title="Corridor Explorer" subtitle="All 6 basket routes — median fare and booking-window breakdown" />
    <div className="kpi-grid" style={{gridTemplateColumns:'repeat(4,minmax(0,1fr))'}}>{corridors.slice(0,4).map(c=><StatCard key={c.route} label={c.route} value={money(c.median_fare)} hint={`${Math.round(c.traffic_weight*100)}% weight · ${c.observation_count} obs`} />)}</div>
    <Panel><SectionTitle title="Route basket" subtitle="Select a corridor to inspect its booking-window profile" />
      <div className="table-shell"><table><thead><tr><th>Route</th><th>Weight</th><th>Median fare</th><th>Observations</th></tr></thead><tbody>{corridors.map(c=><tr key={c.route} className={c.route===selected?'table-highlight':''} onClick={()=>setSelected(c.route)} style={{cursor:'pointer'}}><td><RoutePill route={c.route}/></td><td>{Math.round(c.traffic_weight*100)}%</td><td>{money(c.median_fare)}</td><td>{c.observation_count}</td></tr>)}</tbody></table></div>
    </Panel>
    {route && <div className="detail-grid">
      <Panel><SectionTitle title={`${route.route} · Booking horizon`} subtitle="Observed median total fare" />{vals.length>1?<MiniLine values={vals} labels={labels} color="#f2b643" ariaLabel={`${route.route} fare by booking window`}/>:<div className="chart-empty">Not enough points.</div>}</Panel>
      <Panel><SectionTitle title="Window detail" /><div className="table-shell"><table><thead><tr><th>Window</th><th>Median fare</th><th>Observations</th></tr></thead><tbody>{route.windows.map(w=><tr key={w.window}><td>{w.window}</td><td>{money(w.median_fare)}</td><td>{w.observation_count}</td></tr>)}</tbody></table></div></Panel>
    </div>}
  </>;
}
