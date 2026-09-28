import React from 'react';

export function Panel({ children, className = '', ...props }) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}

export function StatCard({ label, value, hint, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function PageHeader({ kicker, title, subtitle, right }) {
  return (
    <div className="page-header">
      <div>
        {kicker ? <div className="page-kicker">{kicker}</div> : null}
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      {right ? <div className="page-header-right">{right}</div> : null}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title = 'No data available', message }) {
  return (
    <Panel className="empty-state">
      <div className="empty-icon">◌</div>
      <div>
        <strong>{title}</strong>
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </Panel>
  );
}

export function MiniLine({ values = [], labels = [], color = '#43b8ff', height = 170, ariaLabel = 'Trend' }) {
  const clean = values.map(Number).filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <div className="chart-empty">Not enough points for a trend chart.</div>;
  const width = 700;
  const pad = { l: 24, r: 18, t: 16, b: 28 };
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const pts = clean.map((v, i) => {
    const x = pad.l + i * ((width - pad.l - pad.r) / (clean.length - 1));
    const y = pad.t + (height - pad.t - pad.b) * (1 - (v - min) / range);
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${d} L ${pts[pts.length - 1][0].toFixed(1)} ${height - pad.b} L ${pts[0][0].toFixed(1)} ${height - pad.b} Z`;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="line-chart">
        <defs>
          <linearGradient id="apixArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#apixArea)" />
        <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />)}
      </svg>
      <div className="chart-labels">
        {(labels.length ? labels : clean.map((_, i) => String(i + 1))).map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

export function BarList({ items = [], max = null, valueFormatter = (v) => v }) {
  const top = max ?? Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return (
    <div className="bar-list">
      {items.map((item) => {
        const pct = Math.max(5, Math.min(100, ((Number(item.value) || 0) / top) * 100));
        return (
          <div className="bar-row" key={item.label}>
            <div className="bar-meta"><span>{item.label}</span><strong>{valueFormatter(item.value)}</strong></div>
            <div className="bar-track"><span style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ items = [] }) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0) || 1;
  let cumulative = 0;
  const colors = ['#2d9cff', '#f3ba3f', '#27c98f', '#8b74ff', '#f26b5e', '#58c6d8'];
  const segments = items.map((item, i) => {
    const start = cumulative;
    cumulative += (Number(item.value) || 0) / total;
    return { ...item, start, end: cumulative, color: colors[i % colors.length] };
  });
  const toPoint = (p) => {
    const angle = p * Math.PI * 2 - Math.PI / 2;
    return [50 + 35 * Math.cos(angle), 50 + 35 * Math.sin(angle)];
  };
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" className="donut">
        {segments.map((s, i) => {
          const [sx, sy] = toPoint(s.start);
          const [ex, ey] = toPoint(s.end);
          const large = s.end - s.start > 0.5 ? 1 : 0;
          const path = `M 50 50 L ${sx} ${sy} A 35 35 0 ${large} 1 ${ex} ${ey} Z`;
          return <path key={i} d={path} fill={s.color} opacity="0.95" />;
        })}
        <circle cx="50" cy="50" r="21" fill="var(--panel)" />
      </svg>
      <div className="donut-legend">
        {segments.map((s) => <div key={s.label}><span className="legend-dot" style={{ background: s.color }} /><span>{s.label}</span><strong>{Math.round((s.value / total) * 100)}%</strong></div>)}
      </div>
    </div>
  );
}

export function RoutePill({ route }) {
  return <span className="route-pill">{route}</span>;
}

export function Steps({ steps = [] }) {
  return (
    <div className="steps">
      {steps.map((step, i) => (
        <div className="step" key={i}>
          <div className="step-index">{i + 1}</div>
          <div><strong>{step.title}</strong><span>{step.text}</span></div>
          {i !== steps.length - 1 ? <div className="step-line" /> : null}
        </div>
      ))}
    </div>
  );
}
