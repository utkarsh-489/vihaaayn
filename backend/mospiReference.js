'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const MOSPI_REFERENCE_FILE = path.join(DATA_DIR, 'mospi_airfare_reference.json');

function loadReference() {
  if (!fs.existsSync(MOSPI_REFERENCE_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(MOSPI_REFERENCE_FILE, 'utf8'));
    if (!parsed || !parsed.metadata || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function monthKey(record) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const idx = monthNames.indexOf(record.month);
  return `${record.year}-${String(idx + 1).padStart(2, '0')}`;
}

function sortedRecords(records, sector = null) {
  return records
    .filter((r) => !sector || r.sector === sector)
    .map((r) => ({ ...r, period: monthKey(r) }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.sector.localeCompare(b.sector));
}

function buildReference() {
  const reference = loadReference();

  if (!reference) {
    return {
      status: 'NOT_CONFIGURED',
      message: 'MoSPI airfare reference data is not configured.',
      required_file: path.relative(process.cwd(), MOSPI_REFERENCE_FILE),
    };
  }

  const all = sortedRecords(reference.records);
  const combined = sortedRecords(reference.records, 'Combined');
  const rural = sortedRecords(reference.records, 'Rural');
  const urban = sortedRecords(reference.records, 'Urban');
  const latest = combined[combined.length - 1] || null;
  const previous = combined.length > 1 ? combined[combined.length - 2] : null;

  return {
    status: 'CONFIGURED',
    source: reference.metadata.source,
    source_file: reference.metadata.source_file,
    source_note: reference.metadata.source_note,
    metadata: reference.metadata,
    coverage: {
      records: all.length,
      months: combined.length,
      start: combined[0]?.period || null,
      end: latest?.period || null,
      sectors: [...new Set(all.map((r) => r.sector))],
    },
    latest_combined: latest
      ? {
          period: latest.period,
          month: latest.month,
          year: latest.year,
          index: latest.index,
          inflation: latest.inflation,
        }
      : null,
    previous_combined: previous
      ? {
          period: previous.period,
          index: previous.index,
          inflation: previous.inflation,
        }
      : null,
    combined_monthly_change_pct:
      latest && previous && Number.isFinite(latest.index) && Number.isFinite(previous.index)
        ? Math.round(((latest.index / previous.index) - 1) * 10000) / 100
        : null,
    combined,
    rural,
    urban,
  };
}

module.exports = { buildReference, loadReference, MOSPI_REFERENCE_FILE };
