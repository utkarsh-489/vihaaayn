import { useEffect, useState } from 'react';
import { api } from './api';
import NationalIndex from './pages/NationalIndex.jsx';
import CorridorExplorer from './pages/CorridorExplorer.jsx';
import LeadTime from './pages/LeadTime.jsx';
import CollectionMonitor from './pages/CollectionMonitor.jsx';
import Provenance from './pages/Provenance.jsx';
import Methodology from './pages/Methodology.jsx';
import AirlineAnalysis from './pages/AirlineAnalysis.jsx';
import HeatmapCoverage from './pages/HeatmapCoverage.jsx';
import DgcaBacktest from './pages/DgcaBacktest.jsx';

const PAGES = [
  { id: 'index', label: 'National Index', icon: '▦', Component: NationalIndex },
  { id: 'corridors', label: 'Corridor Explorer', icon: '⌁', Component: CorridorExplorer },
  { id: 'leadtime', label: 'Lead-Time Analysis', icon: '◐', Component: LeadTime },
  { id: 'airlines', label: 'Airline Analysis', icon: '✈', Component: AirlineAnalysis },
  { id: 'heatmap', label: 'Heatmap / Coverage', icon: '▥', Component: HeatmapCoverage },
  { id: 'monitor', label: 'Collection Monitor', icon: '◉', Component: CollectionMonitor },
  { id: 'provenance', label: 'Data Provenance', icon: '⌁', Component: Provenance },
  { id: 'dgca', label: 'Reference / Back-test', icon: '◌', Component: DgcaBacktest },
  { id: 'methodology', label: 'Methodology', icon: '⊙', Component: Methodology },
];

export default function App() {
  const [activePage, setActivePage] = useState('index');
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('apix-theme') || 'dark');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('apix-theme', theme);
  }, [theme]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const active = PAGES.find((p) => p.id === activePage) || PAGES[0];

  async function handleTriggerIngestion() {
    setIngesting(true);
    setIngestResult(null);
    try {
      const result = await api.triggerIngestion();
      setIngestResult(result);
    } catch (err) {
      setIngestResult({ status: 'FAILED', error: err.message });
    } finally {
      setIngesting(false);
      setRefreshTick((t) => t + 1);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">विहाय<span>x</span></div>
          <div className="brand-sub">through the sky</div>
          <div className="live-badge"><i /> LIVE ANALYTICS</div>
        </div>

        <nav className="nav-stack">
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${activePage === p.id ? 'active' : ''}`} onClick={() => setActivePage(p.id)}>
              <span className="nav-icon">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">National statistical analytics prototype</div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="top-left"><span className="online-dot" /> <span>SYSTEM ONLINE</span><span className="divider" /> <strong>{active.label}</strong></div>
          <div className="top-right">
            <span className="updated">Updated {now.toLocaleDateString('en-GB')} {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <div className="govt-mark-wrap"><img className="govt-mark" src="/gov-logo.png" alt="Government of India" /></div>
            <button className="run-btn" onClick={handleTriggerIngestion} disabled={ingesting}>{ingesting ? 'Collecting…' : '↻ Run Collection'}</button>
            <div className="theme-switcher">
              <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>☼ Day</button>
              <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>◐ Night</button>
            </div>
          </div>
        </header>
        <div className="tricolor-bar"><span /><span /><span /></div>

        {ingestResult ? (
          <div className={`toast ${ingestResult.status === 'FAILED' ? 'fail' : 'ok'}`}>
            <div><strong>{ingestResult.status}</strong><span>{ingestResult.observations_added !== undefined ? ` · +${ingestResult.observations_added} new observations` : ''}{ingestResult.error ? ` · ${ingestResult.error}` : ''}</span></div>
            <button onClick={() => setIngestResult(null)}>×</button>
          </div>
        ) : null}

        <main className="main">
          {active && <active.Component key={`${active.id}-${refreshTick}`} />}
        </main>
      </div>
    </div>
  );
}
