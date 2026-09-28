const BASE = '/api';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request to ${path} failed (${res.status})`);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  getIndex: () => request('/index'),
  getCorridors: () => request('/corridors'),
  getLeadTime: (route) => request(`/lead-time${route ? `?route=${encodeURIComponent(route)}` : ''}`),
  getCollectorStatus: () => request('/collector/status'),
  triggerIngestion: () => request('/collector/run', { method: 'POST' }),
  getProvenance: () => request('/provenance'),
  getMethodology: () => request('/methodology'),
  getQuality: () => request('/quality'),
  getSchedulerStatus: () => request('/scheduler/status'),
  getDgcaBacktest: () => request('/dgca-backtest'),
  getMospiAirfareReference: () => request('/mospi-airfare-reference'),
  getIndexHistory: () => request('/index-history'),
  getObservations: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/observations${qs ? `?${qs}` : ''}`);
  },
  getAirlineAnalysis: () => request('/airline-analysis'),
  getHeatmap: () => request('/heatmap'),
  getCoverage: () => request('/coverage'),
  getIndexWeekly: () => request('/index/weekly'),
  getIndexMonthly: () => request('/index/monthly'),
  getBacktest30: () => request('/backtest-30day'),
};
