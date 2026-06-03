import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import { assessPositionHealth } from '../../lib/positionHealth.js';
import { buildStressTests } from '../../lib/stressTest.js';
import { sectorExposure } from '../../lib/sectorExposure.js';
import { sectorGaps } from '../../lib/sectorGaps.js';
import { buildPortfolioActions } from '../../lib/portfolioActions.js';
import { fmt, colorFor, getETDateStr } from '../../utils/market.js';
import { computePositionStatus, fmtCompact } from '../../lib/positionStatus.js';
import { renderPlainText } from '../../utils/renderText.js';
import { TickerIcon, Spinner, EmptyState, Modal, FormField, DisclaimerBadge, FeedbackButtons, SkeletonCard } from '../shared/UI.jsx';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';
import StockDossier from '../research/StockDossier.jsx';
import PlanAdherenceCard from './PlanAdherenceCard.jsx';
import PerformanceAttributionCard from './PerformanceAttributionCard.jsx';
import SynthesisCard from './SynthesisCard.jsx';

const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

// computePositionStatus and fmtCompact moved to ../../lib/positionStatus.js
// (imported above) so the attention-badge thresholds and the compact formatter
// are unit-tested in isolation.

/**
 * Detect and skip options contracts.
 * Options tickers have formats like: AAPL 250418C00200000, AAPL250418C200, AAPL_041825C200, etc.
 */
function isOptionsTicker(raw) {
  if (!raw) return false;
  // Options have digits + C/P pattern, or spaces with date+strike, or underscores
  if (/\d{6}[CP]\d/.test(raw)) return true;         // AAPL250418C200
  if (/\s\d{6}[CP]\d/.test(raw)) return true;       // AAPL 250418C200
  if (/_\d{6}[CP]/.test(raw)) return true;           // AAPL_250418C200
  if (/\d{2}\/\d{2}\/\d{2,4}/.test(raw)) return true; // Contains date-like pattern
  if (raw.length > 6 && /[CP]\d{2,}/.test(raw)) return true;
  return false;
}

/**
 * Parse CSV text into position objects.
 * Handles TWO formats:
 * 1. Webull Order Records (transaction history with Side=Buy/Sell) — aggregates into net positions
 * 2. Generic positions CSV (Symbol, Shares, Avg Cost columns) — imports directly
 * Auto-filters options contracts and cancelled orders.
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { positions: [], optionsSkipped: 0, isTransactions: false };

  const parseRow = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const findCol = (candidates) => headers.findIndex(h => candidates.some(c => h.includes(c)));
  const tickerCol = findCol(['symbol', 'ticker', 'sym']);
  const sharesCol = findCol(['quantity', 'shares', 'qty', 'filled', 'totalqty']);
  const costCol = findCol(['avgprice', 'avgcost', 'averagecost', 'averageprice', 'costbasis', 'costpershare', 'unitcost', 'price']);
  const nameCol = findCol(['name', 'companyname', 'company', 'description']);
  const dateCol = findCol(['placedtime', 'filledtime', 'purchasedate', 'date', 'opendate', 'tradedate']);
  const sideCol = findCol(['side', 'action', 'type', 'buysell', 'transactiontype']);
  const statusCol = findCol(['status', 'orderstatus']);
  const filledCol = findCol(['filled']); // Webull has a separate "Filled" column for actual filled qty

  if (tickerCol === -1) return { positions: [], optionsSkipped: 0, isTransactions: false };

  // Detect if this is a transaction history (has Side column with Buy/Sell)
  const isTransactions = sideCol >= 0;
  let optionsSkipped = 0;

  if (isTransactions) {
    // ===== TRANSACTION MODE: Aggregate buys/sells into net positions =====
    // Map: ticker → { totalShares, totalCost, companyName, firstBuyDate }
    const agg = {};

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseRow(lines[i]);
      const rawTicker = cols[tickerCol] || '';

      // Skip options
      if (isOptionsTicker(rawTicker)) { optionsSkipped++; continue; }

      // Skip cancelled/pending orders — only process filled
      if (statusCol >= 0) {
        const status = (cols[statusCol] || '').toLowerCase();
        if (status !== 'filled') continue;
      }

      const ticker = rawTicker.toUpperCase().replace(/[^A-Z]/g, '');
      if (!ticker || ticker.length > 5) continue;

      const side = (cols[sideCol] || '').toLowerCase();
      const isBuy = side.includes('buy');
      const isSell = side.includes('sell');
      if (!isBuy && !isSell) continue;

      // Use "Filled" column for actual qty if available, otherwise "Total Qty"
      const rawQty = filledCol >= 0 ? cols[filledCol] : (sharesCol >= 0 ? cols[sharesCol] : '');
      const qty = parseFloat(rawQty?.replace(/[$,@]/g, ''));
      if (!qty || qty <= 0) continue;

      // Get price — Webull "Avg Price" column
      const rawPrice = costCol >= 0 ? cols[costCol] : '';
      const price = parseFloat(rawPrice?.replace(/[$,@]/g, ''));

      if (!agg[ticker]) {
        agg[ticker] = { totalShares: 0, totalCost: 0, companyName: ticker, firstBuyDate: '' };
      }

      const name = nameCol >= 0 ? (cols[nameCol] || ticker) : ticker;
      if (name !== ticker) agg[ticker].companyName = name;

      if (isBuy) {
        // Weighted average cost: add to total cost and shares
        if (price > 0) agg[ticker].totalCost += qty * price;
        agg[ticker].totalShares += qty;
        // Track earliest buy date
        const dateStr = dateCol >= 0 ? (cols[dateCol] || '') : '';
        if (dateStr && (!agg[ticker].firstBuyDate || dateStr < agg[ticker].firstBuyDate)) {
          agg[ticker].firstBuyDate = dateStr;
        }
      } else if (isSell) {
        // Reduce shares (sells reduce position)
        agg[ticker].totalShares -= qty;
        // Proportionally reduce cost basis
        if (agg[ticker].totalShares > 0 && price > 0) {
          const avgBefore = agg[ticker].totalCost / (agg[ticker].totalShares + qty);
          agg[ticker].totalCost = avgBefore * agg[ticker].totalShares;
        } else if (agg[ticker].totalShares <= 0) {
          agg[ticker].totalCost = 0;
        }
      }
    }

    // Convert to positions — only include tickers with positive shares (still holding)
    const positions = Object.entries(agg)
      .filter(([, v]) => v.totalShares > 0.0001)
      .map(([ticker, v]) => {
        const avgCost = v.totalShares > 0 ? v.totalCost / v.totalShares : 0;
        // Parse Webull date format: "03/31/2026 14:58:20 EDT" → "2026-03-31"
        let purchasedAt = '';
        if (v.firstBuyDate) {
          const match = v.firstBuyDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (match) purchasedAt = `${match[3]}-${match[1]}-${match[2]}`;
        }
        return {
          ticker,
          shares: Math.round(v.totalShares * 10000) / 10000,
          avgCost: avgCost > 0 ? Math.round(avgCost * 1000) / 1000 : 0,
          companyName: v.companyName,
          purchasedAt,
        };
      })
      .sort((a, b) => b.shares * b.avgCost - a.shares * a.avgCost); // Sort by position value

    return { positions, optionsSkipped, isTransactions: true };
  }

  // ===== POSITIONS MODE: Direct import (generic broker CSV) =====
  const positions = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseRow(lines[i]);
    const rawTicker = cols[tickerCol] || '';

    if (isOptionsTicker(rawTicker)) { optionsSkipped++; continue; }

    const ticker = rawTicker.toUpperCase().replace(/[^A-Z]/g, '');
    if (!ticker || ticker.length > 5) continue;

    const rawShares = sharesCol >= 0 ? cols[sharesCol] : '';
    const rawCost = costCol >= 0 ? cols[costCol] : '';
    const shares = parseFloat(rawShares?.replace(/[$,]/g, ''));
    const avgCost = parseFloat(rawCost?.replace(/[$,]/g, ''));

    if (sharesCol >= 0 && (!shares || shares <= 0)) continue;

    let perShareCost = avgCost;
    if (costCol >= 0 && headers[costCol].includes('costbasis') && shares > 0 && avgCost > 0) {
      perShareCost = avgCost / shares;
    }

    positions.push({
      ticker,
      shares: shares > 0 ? shares : 1,
      avgCost: perShareCost > 0 ? Math.round(perShareCost * 1000) / 1000 : 0,
      companyName: nameCol >= 0 ? (cols[nameCol] || ticker) : ticker,
      purchasedAt: dateCol >= 0 ? (cols[dateCol] || '') : '',
    });
  }

  return { positions, optionsSkipped, isTransactions: false };
}

/**
 * Parse quick-paste text. Each line: TICKER SHARES AVGCOST (cost optional)
 * Examples: "AAPL 10 150.50" or "HYMC 50 2.537" or just "TSLA 5"
 */
function parseQuickPaste(text) {
  const lines = text.trim().split(/\r?\n/);
  const positions = [];
  const errors = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // Split by whitespace, comma, or tab
    const parts = trimmed.split(/[\s,\t]+/);
    const ticker = (parts[0] || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!ticker || ticker.length > 5) { errors.push(`"${parts[0]}" — not a valid ticker`); continue; }

    const shares = parseFloat(parts[1]);
    if (!shares || shares <= 0) { errors.push(`${ticker} — need a share count`); continue; }

    const avgCost = parts[2] ? parseFloat(parts[2].replace(/[$,]/g, '')) : 0;

    positions.push({
      ticker,
      shares: Math.round(shares * 10000) / 10000,
      avgCost: avgCost > 0 ? Math.round(avgCost * 1000) / 1000 : 0,
      companyName: ticker,
      purchasedAt: '',
    });
  }

  return { positions, errors };
}

function ImportModal({ onClose, onDone, showToast }) {
  const [mode, setMode] = useState('screenshot'); // screenshot, paste, or csv
  const [step, setStep] = useState('input'); // input → preview → importing → done
  const [parsed, setParsed] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [optionsSkipped, setOptionsSkipped] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [editingIdx, setEditingIdx] = useState(null);

  // Ref keeps parsed data reliable across async screenshot calls
  const parsedRef = useRef([]);
  const scCountRef = useRef(0);
  function setParsedAndRef(val) {
    const next = typeof val === 'function' ? val(parsedRef.current) : val;
    parsedRef.current = next;
    setParsed(next);
  }

  function handleFile(file) {
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const { positions, optionsSkipped: skipped } = parseCSV(e.target.result);
      if (positions.length === 0) {
        setError(skipped > 0
          ? `Found ${skipped} options contracts but no stock positions. Options aren't supported yet.`
          : 'No positions found. Make sure the CSV has a "Symbol" or "Ticker" column.');
        return;
      }
      setParsedAndRef(positions);
      setOptionsSkipped(skipped);
      setStep('preview');
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  }

  function mergePositions(existing, incoming) {
    const map = new Map();
    for (const p of existing) map.set(p.ticker, { ...p });
    for (const p of incoming) {
      const prev = map.get(p.ticker);
      if (prev) {
        if ((!prev.shares || prev.shares === 0) && p.shares > 0) prev.shares = p.shares;
        if ((!prev.avgCost || prev.avgCost === 0) && p.avgCost > 0) prev.avgCost = p.avgCost;
        if (!prev.companyName && p.companyName) prev.companyName = p.companyName;
        if (p.shares > 0 && p.avgCost > 0) { prev.shares = p.shares; prev.avgCost = p.avgCost; }
        map.set(p.ticker, prev);
      } else {
        map.set(p.ticker, { ...p });
      }
    }
    return Array.from(map.values());
  }

  async function handleScreenshot(file) {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Please upload an image file (PNG, JPG, etc.)'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('Image too large — under 10MB please.'); return; }
    setScanning(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.portfolio.parseScreenshot(base64);
      const positions = res.positions || [];
      if (positions.length === 0) {
        setError('No positions found. Make sure the screenshot shows your portfolio with stock symbols visible.');
        setScanning(false);
        return;
      }
      const existing = parsedRef.current;
      const merged = existing.length > 0 ? mergePositions(existing, positions) : positions;
      setParsedAndRef(merged);
      scCountRef.current += 1;
      setScreenshotCount(scCountRef.current);
      setStep('preview');
    } catch (e) {
      setError(e.error || 'Failed to read screenshot. Try a clearer image.');
    } finally {
      setScanning(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (mode === 'screenshot') { if (file) handleScreenshot(file); else setError('Could not read the dropped file'); }
    else { if (file) handleFile(file); else setError('Could not read the dropped file'); }
  }

  function handlePaste() {
    if (!pasteText.trim()) { setError('Paste your positions above'); return; }
    setError('');
    const { positions, errors } = parseQuickPaste(pasteText);
    if (positions.length === 0) {
      setError(errors.length > 0 ? errors.join(', ') : 'No valid positions found. Format: TICKER SHARES COST (one per line)');
      return;
    }
    setParsedAndRef(positions);
    setStep('preview');
  }

  function updatePosition(idx, field, value) {
    setParsedAndRef(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }
  function removePosition(idx) {
    setParsedAndRef(prev => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }

  async function doImport() {
    const valid = parsed.filter(p => p.shares > 0);
    if (valid.length === 0) { setError('No valid positions to import'); return; }
    setStep('importing');
    try {
      const res = await api.portfolio.importPositions(valid);
      setResult(res);
      setStep('done');
      if (res.added > 0) onDone();
    } catch (e) {
      setError(e.error || 'Import failed');
      setStep('preview');
    }
  }

  const modeBtn = (id, label) => (
    <button onClick={() => { setMode(id); setError(''); }} style={{ flex: 1, padding: '7px 0', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: mode === id ? 'var(--blue)' : 'var(--raised)', color: mode === id ? '#fff' : 'var(--faint)' }}>
      {label}
    </button>
  );
  const inputStyle = { width: '100%', padding: '5px 8px', fontSize: 12, background: 'var(--base)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' };

  return (
    <Modal title="IMPORT POSITIONS" onClose={onClose}>
      {step === 'input' && (
        <div>
          <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {modeBtn('screenshot', 'SCREENSHOT')}
            {modeBtn('paste', 'QUICK PASTE')}
            {modeBtn('csv', 'CSV FILE')}
          </div>

          {mode === 'screenshot' && (
            <div>
              {/* Banner when coming back for another screenshot */}
              {parsedRef.current.length > 0 && (
                <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 6, marginBottom: 10, border: '1px solid rgba(34,197,94,0.3)' }}>
                  <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                    {parsedRef.current.length} position{parsedRef.current.length !== 1 ? 's' : ''} loaded — add more below
                  </p>
                </div>
              )}

              {/* Instructions — first time only */}
              {parsedRef.current.length === 0 && (
                <div style={{ padding: '10px 12px', background: 'var(--raised)', borderRadius: 6, marginBottom: 12, border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 11, color: 'var(--text)', fontWeight: 700, marginBottom: 4 }}>
                    Screenshot your positions list
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Open your broker app, go to your positions, and screenshot. AI reads the ticker, shares, and avg cost automatically. Works with any broker.
                  </p>
                </div>
              )}

              {scanning ? (
                <div style={{ textAlign: 'center', padding: '28px 16px' }}>
                  <Spinner />
                  <p style={{ fontSize: 12, color: 'var(--blue)', marginTop: 12, fontWeight: 600 }}>Reading your portfolio...</p>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('screenshot-file-input')?.click()}
                  style={{ border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 8, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(59,130,246,0.08)' : 'var(--raised)', transition: 'all 0.15s' }}
                >
                  <p style={{ fontSize: 28, marginBottom: 6 }}>📸</p>
                  <p style={{ fontSize: 12, color: dragOver ? 'var(--blue)' : 'var(--muted)', fontWeight: 600 }}>Drop screenshot here</p>
                  <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>or tap to upload</p>
                  <input id="screenshot-file-input" type="file" accept="image/*" onChange={(e) => { handleScreenshot(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
                </div>
              )}
            </div>
          )}

          {mode === 'paste' && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
                One position per line — just ticker, shares, and cost:
              </p>
              <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 10, fontFamily: 'monospace', lineHeight: 1.8, background: 'var(--raised)', padding: '8px 10px', borderRadius: 6 }}>
                AAPL 10 150.50<br/>HYMC 50 2.537<br/>TSLA 5<br/>PLTR 100 24.80
              </p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={'AAPL 10 150.50\nHYMC 50 2.537\nTSLA 5'}
                style={{ width: '100%', minHeight: 120, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', color: 'var(--text)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.8, boxSizing: 'border-box' }}
              />
              <button onClick={handlePaste} className="btn btn-green" style={{ width: '100%', marginTop: 10 }}>Preview Positions</button>
            </div>
          )}

          {mode === 'csv' && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
                Drop a CSV export from your broker. Options are automatically filtered out.
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('csv-file-input')?.click()}
                style={{ border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 8, padding: '32px 16px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(59,130,246,0.08)' : 'var(--raised)', transition: 'all 0.15s' }}
              >
                <p style={{ fontSize: 20, marginBottom: 8 }}>CSV</p>
                <p style={{ fontSize: 12, color: dragOver ? 'var(--blue)' : 'var(--muted)', fontWeight: 600 }}>Drop CSV file here</p>
                <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>or click to browse</p>
                <input id="csv-file-input" type="file" accept=".csv,.txt" onChange={(e) => handleFile(e.target.files?.[0])} style={{ display: 'none' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, marginBottom: 4 }}>
            {parsed.length} position{parsed.length !== 1 ? 's' : ''} found
            {screenshotCount > 1 && <span style={{ color: 'var(--faint)', fontWeight: 400 }}> (merged from {screenshotCount} screenshots)</span>}
          </p>
          {optionsSkipped > 0 && (
            <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 4 }}>{optionsSkipped} options filtered out</p>
          )}
          <p style={{ fontSize: 9, color: 'var(--faint)', marginBottom: 8 }}>
            Tap to edit if anything looks off
          </p>

          <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}>
            {parsed.map((p, i) => (
              <div key={p.ticker + i} style={{ borderBottom: '1px solid var(--border)' }}>
                <div
                  onClick={() => setEditingIdx(editingIdx === i ? null : i)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TickerIcon ticker={p.ticker} size={24} />
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.ticker}</span>
                      {p.companyName && p.companyName !== p.ticker && <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 6 }}>{p.companyName}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 11, color: 'var(--text)' }}>{p.shares} shares</p>
                      {p.avgCost > 0 && <p style={{ fontSize: 10, color: 'var(--faint)' }}>@ ${p.avgCost}</p>}
                      {(!p.avgCost || p.avgCost === 0) && <p style={{ fontSize: 9, color: 'var(--amber)' }}>no cost — tap to add</p>}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--faint)', transform: editingIdx === i ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▼</span>
                  </div>
                </div>

                {editingIdx === i && (
                  <div style={{ padding: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, marginBottom: 2, display: 'block' }}>SHARES</label>
                        <input type="number" step="any" value={p.shares || ''} onChange={e => updatePosition(i, 'shares', parseFloat(e.target.value) || 0)} style={inputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, marginBottom: 2, display: 'block' }}>AVG COST</label>
                        <input type="number" step="any" value={p.avgCost || ''} onChange={e => updatePosition(i, 'avgCost', parseFloat(e.target.value) || 0)} style={inputStyle} />
                      </div>
                    </div>
                    <button onClick={() => removePosition(i)} style={{ alignSelf: 'flex-end', padding: '3px 10px', fontSize: 9, color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, opacity: 0.7 }}>Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add more screenshots */}
          {mode === 'screenshot' && (
            <button onClick={() => { setStep('input'); setError(''); }} style={{ width: '100%', padding: '8px 0', marginBottom: 8, fontSize: 10, fontWeight: 600, color: 'var(--blue)', background: 'transparent', border: '1px dashed var(--blue)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
              + Add another screenshot
            </button>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setStep('input'); setParsedAndRef([]); setError(''); setOptionsSkipped(0); setScreenshotCount(0); scCountRef.current = 0; setEditingIdx(null); }} className="btn btn-muted" style={{ flex: 1 }}>Start Over</button>
            <button onClick={doImport} className="btn btn-green" style={{ flex: 2 }}>Import {parsed.length} Position{parsed.length !== 1 ? 's' : ''}</button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spinner />
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>Importing positions...</p>
        </div>
      )}

      {step === 'done' && result && (
        <div>
          {result.added > 0 && (
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>
              {result.added} position{result.added !== 1 ? 's' : ''} imported
            </p>
          )}
          {result.added === 0 && (
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>No new positions added</p>
          )}
          {result.skipped?.length > 0 && (
            <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 6 }}>
              Already in portfolio: {result.skipped.join(', ')}
            </p>
          )}
          {result.errors?.length > 0 && (
            <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 6, marginBottom: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>Issues:</p>
              {result.errors.map((e, i) => <p key={i} style={{ fontSize: 10, color: 'var(--red)', marginBottom: 2 }}>{e}</p>)}
            </div>
          )}
          <button onClick={onClose} className="btn btn-blue" style={{ width: '100%' }}>Done</button>
        </div>
      )}

      {error && <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

/**
 * ThesisAssistField — textarea + "Help me write this" button.
 * Used by AddModal + the position card edit form + the close-position flow.
 * Calls the appropriate AI assist endpoint and fills the textarea with the
 * draft. User can then edit, accept, or rewrite from scratch.
 */
function ThesisAssistField({ label, placeholder, value, onChange, rows = 3, assist }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function handleAssist() {
    if (!assist) return;
    setLoading(true); setErr('');
    try {
      const draft = await assist(value);
      if (draft) onChange(draft);
    } catch (e) {
      setErr(e.error || 'Assist unavailable — try writing it yourself.');
    }
    setLoading(false);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 4 }}>
          {label}
        </p>
      )}
      <textarea
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value.slice(0, 500))}
        rows={rows}
        style={{ width: '100%', fontSize: 11, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
      />
      {assist && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <button
            type="button"
            onClick={handleAssist}
            disabled={loading}
            style={{
              fontSize: 10, color: 'var(--blue)', background: 'none', border: 'none',
              cursor: loading ? 'default' : 'pointer', padding: '4px 0',
              letterSpacing: '0.3px', fontFamily: 'inherit',
            }}
          >
            {loading ? 'Drafting…' : value ? '✦ Improve this' : '✦ Help me write this'}
          </button>
          <span style={{ fontSize: 9, color: 'var(--faint)' }}>{value.length}/500</span>
        </div>
      )}
      {err && <p style={{ fontSize: 10, color: 'var(--red)', marginTop: 4 }}>{err}</p>}
    </div>
  );
}

/**
 * SkipThesisModal — soft-skip prompt shown when the user tries to save a
 * position (or close one) without writing a thesis / reflection. Never blocks
 * — gives them the option to proceed, but makes the choice explicit.
 */
function SkipThesisModal({ kind, onWrite, onSkip }) {
  const isClose = kind === 'reflection';
  return (
    <Modal title={isClose ? 'Skip the reflection?' : 'Skip the thesis?'} onClose={onSkip}>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
        {isClose
          ? 'Skipping is fine, but Outpost gets meaningfully more useful when you capture what happened and what you learned. The next time you trade a stock like this one, your past reflections become the most valuable thing in the room.'
          : 'Skipping is fine, but Outpost gets meaningfully more useful when you capture why you\'re making each decision. Want to take 30 seconds to write it?'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSkip} className="btn btn-muted" style={{ flex: 1 }}>Skip for now</button>
        <button onClick={onWrite} className="btn btn-blue" style={{ flex: 1 }}>Write it</button>
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onDone, showToast, prefill, onPrefillConsumed, isFirstPosition, onAdded }) {
  // Phase 4 — when opened via a Deploy Cash pick, prefill the form with
  // the chosen recommendation's ticker/shares/cost/reasoning. The user can
  // edit any field before saving.
  const [form, setForm] = useState(() => prefill ? {
    ticker: prefill.ticker || '',
    companyName: prefill.companyName || '',
    shares: prefill.shares || '',
    avgCost: prefill.avgCost || '',
    purchasedAt: '',
    entryThesis: prefill.entryThesis || '',
    reversalCondition: '',
    priceTarget: '',
    stopLoss: '',
  } : {
    ticker: '', companyName: '', shares: '', avgCost: '', purchasedAt: '',
    entryThesis: '', reversalCondition: '',
    priceTarget: '', stopLoss: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPlan, setShowPlan] = useState(false);

  // Pre-trade gut-check — one sharp question rooted in the user's history with
  // this ticker. Fires once the ticker reaches 1-5 letters and stabilizes. We
  // cache per-ticker so flipping between tickers doesn't re-fire, and so the
  // user doesn't see the question vanish/refetch on every keystroke.
  // gutCheckCache: { [ticker]: { question, grounded } }
  const [gutCheck, setGutCheck] = useState(null);  // current question to show, null = hidden
  const [gutCheckLoading, setGutCheckLoading] = useState(false);
  const gutCheckCacheRef = useRef({});

  useEffect(() => {
    const t = (form.ticker || '').toUpperCase().trim();
    // Ticker must be 1-5 alpha chars. Anything else, clear the card and bail.
    if (!t || !/^[A-Z]{1,5}$/.test(t)) {
      setGutCheck(null);
      setGutCheckLoading(false);
      return;
    }
    // Already cached for this ticker — surface it instantly, no fetch.
    if (gutCheckCacheRef.current[t]) {
      setGutCheck(gutCheckCacheRef.current[t]);
      setGutCheckLoading(false);
      return;
    }
    // Debounce ~500ms so we don't fire on every keystroke. Cancel on unmount
    // or ticker-change.
    setGutCheckLoading(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await api.portfolio.gutCheck(t);
        if (cancelled) return;
        const cached = { question: res?.question || '', grounded: !!res?.grounded };
        gutCheckCacheRef.current[t] = cached;
        setGutCheck(cached);
      } catch {
        // Silent on failure — the gut-check is a nudge, not critical path.
        if (!cancelled) setGutCheck(null);
      } finally {
        if (!cancelled) setGutCheckLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [form.ticker]);

  function basicsValid() {
    if (!form.ticker || !form.shares) { setError('Ticker and shares are required'); return false; }
    const shares = parseFloat(form.shares);
    const avgCost = form.avgCost ? parseFloat(form.avgCost) : 0;
    if (isNaN(shares) || shares <= 0) { setError('Shares must be a positive number'); return false; }
    if (form.avgCost && (isNaN(avgCost) || avgCost < 0)) { setError('Average cost must be a valid number'); return false; }
    setError('');
    return true;
  }

  function attemptSave() {
    if (!basicsValid()) return;
    // Phase 5 lighten — thesis is now genuinely optional at first add. The
    // soft-skip modal interruption was friction the user didn't want. The
    // position card still shows the "no thesis yet — write it" nudge after
    // save, and the agent can prompt for missing theses proactively later.
    doSave();
  }

  async function doSave() {
    setSaving(true); setError('');
    try {
      const shares = parseFloat(form.shares);
      const avgCost = form.avgCost ? parseFloat(form.avgCost) : 0;
      const body = { ticker: form.ticker, companyName: form.companyName, shares, avgCost, purchasedAt: form.purchasedAt };
      if (form.entryThesis.trim()) body.entryThesis = form.entryThesis.trim();
      if (form.reversalCondition.trim()) body.reversalCondition = form.reversalCondition.trim();
      if (form.priceTarget) body.priceTarget = parseFloat(form.priceTarget);
      if (form.stopLoss) body.stopLoss = parseFloat(form.stopLoss);
      // Phase 4 — tag the position with where it came from so the Timeline
      // can attribute it back to the Deploy Cash session that produced it.
      if (prefill?.source) body.source = prefill.source;
      const result = await api.portfolio.addPosition(body);
      // Record the executed position back on the Deploy Cash session so future
      // check-ins ("you deployed $X into Y — here's how it's tracking") work.
      if (prefill?.sessionId && prefill?.optionId && result?.position?.id) {
        api.ai.deployCashChoice({
          session_id: prefill.sessionId,
          option_id: prefill.optionId,
          executed_position_id: result.position.id,
        }).catch(() => {}); // non-blocking
      }
      const addedTicker = (form.ticker || '').toUpperCase().trim();
      showToast(`${addedTicker} added to portfolio`, 'success');
      setForm({ ticker: '', companyName: '', shares: '', avgCost: '', purchasedAt: '', entryThesis: '', reversalCondition: '', priceTarget: '', stopLoss: '' });
      setShowPlan(false);
      onPrefillConsumed?.();
      onDone();
      // First position ever: surface an instant AI read so a brand-new user
      // feels the app working in seconds instead of hunting three taps deep.
      if (isFirstPosition) onAdded?.(addedTicker);
      onClose();
    } catch (e) { setError(e.error || 'Failed to add position'); setSaving(false); }
  }

  // AI assist helpers — bind ticker context to the assist call.
  const ticker = form.ticker.toUpperCase().trim();
  const assistEntry = ticker
    ? async (currentValue) => {
        const d = await api.ai.thesisAssist({ ticker, field: 'entry', userNote: currentValue });
        return d.draft;
      }
    : null;
  const assistReversal = ticker
    ? async (currentValue) => {
        const d = await api.ai.thesisAssist({ ticker, field: 'reversal', userNote: currentValue });
        return d.draft;
      }
    : null;

  return (
    <>
      <Modal title="Add Position" onClose={onClose}>
        <FormField label="Ticker"><input className="input" placeholder="AAPL" value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))} /></FormField>
        <FormField label="Company Name (optional)"><input className="input" placeholder="Apple Inc." value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} /></FormField>
        <FormField label="Number of Shares"><input className="input" type="number" placeholder="10" value={form.shares} onChange={e => setForm(f => ({ ...f, shares: e.target.value }))} /></FormField>
        <FormField label="Average Cost (optional)"><input className="input" type="number" placeholder="150.00" value={form.avgCost} onChange={e => setForm(f => ({ ...f, avgCost: e.target.value }))} /></FormField>
        <FormField label="Date Purchased (optional)"><input className="input" type="date" value={form.purchasedAt} max={`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`} onChange={e => setForm(f => ({ ...f, purchasedAt: e.target.value }))} /></FormField>
        <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
          If you've added to this position over multiple dates, use your earliest purchase or leave it blank. Outpost would rather know the date is unknown than guess wrong about how long you've held it.
        </p>

        {/* Pre-trade gut-check — appears once the user types a valid ticker.
            One sharp question grounded in their actual history with the name
            (or a thesis-shaping question if no history). Shown above the plan
            section so the user reads it before they write their thesis. The
            question is NOT stored — it surfaces once and then they decide. */}
        {(gutCheck?.question || gutCheckLoading) && (
          <div style={{
            background: 'rgba(59,130,246,0.07)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 12,
          }}>
            <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>
              OUTPOST ASKS{gutCheck?.grounded ? ' (FROM YOUR HISTORY)' : ''}
            </p>
            {gutCheckLoading && !gutCheck?.question ? (
              <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic' }}>Thinking…</p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>{gutCheck.question}</p>
            )}
          </div>
        )}

        {/* PLAN — ALL OPTIONAL at first add (Phase 5 lighten). Thesis + price
            targets collapsed into one "+ ADD A PLAN" expand so the default
            add flow is just ticker + shares + cost. The position card surfaces
            "no thesis yet — write it" nudge after save for users who skip. */}
        {!showPlan ? (
          <button
            onClick={() => setShowPlan(true)}
            style={{ fontSize: 10, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginTop: 4, marginBottom: 8, letterSpacing: '0.3px' }}
          >
            + ADD A PLAN (optional — thesis, target, stop. Add later anytime.)
          </button>
        ) : (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 4 }}>
            <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginBottom: 4 }}>
              YOUR PLAN <span style={{ color: 'var(--faint)', fontWeight: 500, letterSpacing: '0.3px', marginLeft: 4 }}>(all optional)</span>
            </p>
            <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.5 }}>
              Add any of these now, or skip and Outpost will ask later when it makes sense.
            </p>

            <ThesisAssistField
              label="WHY ARE YOU BUYING THIS?"
              placeholder="What's the story here? Why this stock, why now?"
              value={form.entryThesis}
              onChange={v => setForm(f => ({ ...f, entryThesis: v }))}
              rows={3}
              assist={assistEntry}
            />

            <ThesisAssistField
              label="WHAT WOULD MAKE YOU CHANGE YOUR MIND?"
              placeholder="What would have to happen for you to sell or cut your losses?"
              value={form.reversalCondition}
              onChange={v => setForm(f => ({ ...f, reversalCondition: v }))}
              rows={3}
              assist={assistReversal}
            />

            {!ticker && (
              <p style={{ fontSize: 9, color: 'var(--faint)', marginTop: -4, marginBottom: 8, fontStyle: 'italic' }}>
                Enter a ticker above to enable the AI assist on these fields.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <FormField label="Price Target $"><input className="input" type="number" placeholder="200.00" value={form.priceTarget} onChange={e => setForm(f => ({ ...f, priceTarget: e.target.value }))} /></FormField>
              <FormField label="Stop Loss $"><input className="input" type="number" placeholder="120.00" value={form.stopLoss} onChange={e => setForm(f => ({ ...f, stopLoss: e.target.value }))} /></FormField>
            </div>
          </div>
        )}

        {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{error}</p>}
        <button onClick={attemptSave} disabled={saving} className="btn btn-green btn-full">{saving ? 'Adding...' : 'Add Position'}</button>
      </Modal>

    </>
  );
}

/**
 * Compact status pill that calls out plan urgency at a glance.
 * Replaces the previous static "PLAN" label so the user sees WHY they should
 * care — not just "this position has a plan" but "your stop just broke."
 *
 * Priority order (highest urgency wins):
 *   STOP BROKEN  → price has fallen below stop_loss
 *   TARGET HIT   → price has risen past price_target
 *   NEAR STOP    → within 10% above stop_loss
 *   NEAR TARGET  → within 10% below price_target
 *   PLAN         → plan exists but no level is in range
 */
function PlanStatusBadge({ pos }) {
  const hasTarget = pos.price_target && pos.price_target > 0;
  const hasStop = pos.stop_loss && pos.stop_loss > 0;
  const current = pos.currentPrice;
  if (!hasTarget && !hasStop && !pos.entry_thesis) return null;
  if (!current) return <Pill text="PLAN" color="var(--blue)" />;

  if (hasStop && current < pos.stop_loss) {
    return <Pill text="STOP BROKEN" color="var(--red)" pulse />;
  }
  if (hasTarget && current >= pos.price_target) {
    return <Pill text="TARGET HIT" color="var(--green)" pulse />;
  }
  if (hasStop) {
    const stopDist = ((current - pos.stop_loss) / current) * 100;
    if (stopDist >= 0 && stopDist <= 10) {
      return <Pill text={`STOP ${stopDist.toFixed(1)}%`} color="var(--amber)" />;
    }
  }
  if (hasTarget) {
    const targetDist = ((pos.price_target - current) / current) * 100;
    if (targetDist >= 0 && targetDist <= 10) {
      return <Pill text={`TGT ${targetDist.toFixed(1)}%`} color="var(--green)" />;
    }
  }
  return <Pill text="PLAN" color="var(--blue)" />;
}

function Pill({ text, color, pulse }) {
  return (
    <span style={{
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: '0.3px',
      color,
      marginLeft: 5,
      padding: '1px 5px',
      borderRadius: 3,
      background: `${color}1a`,
      border: `1px solid ${color}33`,
      verticalAlign: 'middle',
      display: 'inline-block',
      animation: pulse ? 'planPulse 1.6s ease-in-out infinite' : 'none',
    }}>
      <style>{`@keyframes planPulse { 0%,100%{opacity:1} 50%{opacity:0.55} }`}</style>
      {text}
    </span>
  );
}

function TradePlanBar({ pos }) {
  const hasTarget = pos.price_target && pos.price_target > 0;
  const hasStop = pos.stop_loss && pos.stop_loss > 0;
  if (!hasTarget && !hasStop) return null;

  const current = pos.currentPrice;
  const target = pos.price_target || current * 1.2;
  const stop = pos.stop_loss || current * 0.8;
  const range = target - stop;
  if (range <= 0) return null;

  const currentPct = Math.max(0, Math.min(100, ((current - stop) / range) * 100));
  const targetDist = hasTarget ? ((target - current) / current * 100).toFixed(1) : null;
  const stopDist = hasStop ? ((stop - current) / current * 100).toFixed(1) : null;

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 3 }}>
        {hasStop && <span style={{ color: 'var(--red)' }}>Stop ${fmt(stop)} ({stopDist}%)</span>}
        <span style={{ flex: 1 }} />
        {hasTarget && <span style={{ color: 'var(--green)' }}>Target ${fmt(target)} (+{targetDist}%)</span>}
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--raised)', position: 'relative', overflow: 'visible' }}>
        {hasStop && <div style={{ position: 'absolute', left: 0, top: -1, width: 2, height: 6, background: 'var(--red)', borderRadius: 1 }} />}
        {hasTarget && <div style={{ position: 'absolute', right: 0, top: -1, width: 2, height: 6, background: 'var(--green)', borderRadius: 1 }} />}
        <div style={{ position: 'absolute', left: `${currentPct}%`, top: -2, width: 6, height: 8, background: 'var(--blue)', borderRadius: 2, transform: 'translateX(-3px)' }} />
        <div style={{ height: '100%', width: `${currentPct}%`, background: currentPct > 50 ? 'var(--green)' : 'var(--red)', borderRadius: 2, opacity: 0.3 }} />
      </div>
    </div>
  );
}

function EarningsBadge({ earnings }) {
  // ⚠️ Earnings feature disabled (2026-04-15) — free-tier data sources
  // (Finnhub, FMP) are unreliable/paywalled for forward earnings dates.
  // Backend now short-circuits earnings fetches too. Re-enable by removing
  // this early return once we have a paid source.
  return null;
  // eslint-disable-next-line no-unreachable
  if (!earnings?.upcoming || !earnings?.date?.trim?.()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earnings.date)) return null;
  const todayStr = getETDateStr();
  const todayMs = Date.parse(todayStr + 'T00:00:00Z');
  const earningsMs = Date.parse(earnings.date + 'T00:00:00Z');
  if (!Number.isFinite(earningsMs)) return null;
  const daysAway = Math.round((earningsMs - todayMs) / 86400000);
  if (daysAway < 0 || daysAway > 30) return null;
  const label = daysAway === 0 ? 'TODAY' : daysAway === 1 ? 'TOMORROW' : `${daysAway}d`;
  const timeLabel = earnings.time === 'bmo' ? 'pre' : earnings.time === 'amc' ? 'post' : '';
  const urgentColor = daysAway <= 3 ? 'var(--amber)' : 'var(--faint)';
  return (
    <span style={{ fontSize: 8, color: urgentColor, marginLeft: 5, verticalAlign: 'middle', letterSpacing: '0.3px' }}>
      ER {label}{timeLabel ? ` ${timeLabel}` : ''}
    </span>
  );
}

function StockDetails({ ticker }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    cachedFetch(`stock_details_${ticker}`, () => api.portfolio.stockDetails(ticker), 5 * 60000)
      .then(d => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [ticker]);
  if (loading) return <div style={{ padding: '8px 0', textAlign: 'center' }}><Spinner size={12} /></div>;
  if (!data?.financials && !data?.analyst) return <p style={{ fontSize: 10, color: 'var(--faint)', padding: '4px 0' }}>No data available</p>;
  const f = data.financials;
  const a = data.analyst;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {f && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {f.pe != null && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>P/E <b style={{ color: 'var(--text)' }}>{f.pe?.toFixed(1)}</b></span>}
          {f.marketCap && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>MCap <b style={{ color: 'var(--text)' }}>${f.marketCap >= 1e12 ? (f.marketCap / 1e12).toFixed(1) + 'T' : f.marketCap >= 1e9 ? (f.marketCap / 1e9).toFixed(0) + 'B' : (f.marketCap / 1e6).toFixed(0) + 'M'}</b></span>}
          {f.eps != null && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>EPS <b style={{ color: 'var(--text)' }}>${f.eps?.toFixed(2)}</b></span>}
          {f.beta != null && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>Beta <b style={{ color: 'var(--text)' }}>{f.beta?.toFixed(2)}</b></span>}
          {f.dividendYield > 0 && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>Div <b style={{ color: 'var(--text)' }}>{f.dividendYield}%</b></span>}
          {f.yearHigh && <span style={{ fontSize: 9, color: 'var(--faint)', background: 'var(--surface)', padding: '3px 6px', borderRadius: 4 }}>52w <b style={{ color: 'var(--red)' }}>${fmt(f.yearLow)}</b>-<b style={{ color: 'var(--green)' }}>${fmt(f.yearHigh)}</b></span>}
        </div>
      )}
      {a && a.totalAnalysts > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: 'var(--faint)' }}>
          <span style={{ fontWeight: 700, color: a.consensus === 'Buy' ? 'var(--green)' : a.consensus === 'Sell' ? 'var(--red)' : 'var(--amber)' }}>
            {a.consensus?.toUpperCase()}
          </span>
          <span>{a.buy}B/{a.hold}H/{a.sell}S</span>
          {a.targetPrice && <span>Target <b style={{ color: 'var(--text)' }}>${fmt(a.targetPrice)}</b></span>}
        </div>
      )}
    </div>
  );
}

/**
 * Alerts panel rendered inside a PositionCard. Lists existing alerts for
 * the ticker, lets the user create a quick "above" / "below" / "% change"
 * alert, and supports deleting or re-arming triggered ones.
 */
function AlertsPanel({ ticker, currentPrice, onBack, showToast }) {
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ direction: 'above', threshold: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const { alerts: all } = await api.alerts.list();
      setAlerts((all || []).filter(a => a.ticker === ticker));
    } catch (e) {
      setErr(e.error || 'Failed to load alerts');
    }
    setLoading(false);
  }, [ticker]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    const threshold = parseFloat(form.threshold);
    if (!isFinite(threshold)) { setErr('Invalid threshold'); return; }
    setCreating(true); setErr('');
    try {
      await api.alerts.create({
        ticker,
        direction: form.direction,
        threshold,
        note: form.note.trim() || undefined,
      });
      setForm({ direction: 'above', threshold: '', note: '' });
      showToast?.(`Alert set for ${ticker}`, 'success');
      load();
    } catch (e) {
      setErr(e.error || 'Failed to create alert');
    }
    setCreating(false);
  }

  async function remove(id) {
    try {
      await api.alerts.remove(id);
      load();
    } catch (e) { setErr(e.error || 'Failed to delete'); }
  }

  async function reset(id) {
    try {
      await api.alerts.update(id, { reset: true });
      load();
    } catch (e) { setErr(e.error || 'Failed to reset'); }
  }

  const placeholder = form.direction === 'percent_change'
    ? '+5 or -5 (%)'
    : currentPrice ? String(currentPrice) : '0.00';

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 13px' }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', marginBottom: 8 }}>{ticker} ALERTS</p>

      {loading ? (
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>Loading...</p>
      ) : (
        <>
          {(alerts?.length ?? 0) === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 10 }}>No alerts yet for this ticker.</p>
          ) : (
            <div style={{ marginBottom: 10 }}>
              {alerts.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--raised)', borderRadius: 5, marginBottom: 4, fontSize: 10 }}>
                  <span style={{ flex: 1, color: 'var(--muted)' }}>
                    {a.triggered ? (
                      <span style={{ color: 'var(--amber)', fontWeight: 700 }}>TRIGGERED · </span>
                    ) : null}
                    {a.direction === 'above' ? `${ticker} ≥ $${parseFloat(a.threshold).toFixed(2)}`
                      : a.direction === 'below' ? `${ticker} ≤ $${parseFloat(a.threshold).toFixed(2)}`
                      : `${ticker} day change ${parseFloat(a.threshold) >= 0 ? '+' : ''}${parseFloat(a.threshold).toFixed(1)}%`}
                    {a.note && <span style={{ color: 'var(--faint)', fontStyle: 'italic' }}> · {a.note}</span>}
                  </span>
                  {a.triggered && (
                    <button onClick={() => reset(a.id)} className="btn btn-muted" style={{ fontSize: 8, padding: '3px 6px' }}>RESET</button>
                  )}
                  <button onClick={() => remove(a.id)} className="btn btn-muted" style={{ fontSize: 8, padding: '3px 6px' }}>DELETE</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: 'var(--raised)', borderRadius: 5, padding: '8px 9px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              {['above', 'below', 'percent_change'].map(d => (
                <button
                  key={d}
                  onClick={() => setForm(f => ({ ...f, direction: d }))}
                  className={`btn ${form.direction === d ? 'btn-blue' : 'btn-muted'}`}
                  style={{ flex: 1, fontSize: 9, padding: '5px 0' }}
                >
                  {d === 'above' ? 'ABOVE' : d === 'below' ? 'BELOW' : '% MOVE'}
                </button>
              ))}
            </div>
            <input
              className="input"
              type="number"
              value={form.threshold}
              onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
              placeholder={placeholder}
              style={{ fontSize: 12, marginBottom: 6, width: '100%' }}
            />
            <input
              className="input"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value.slice(0, 200) }))}
              placeholder="Optional note (e.g. 'take profits here')"
              style={{ fontSize: 11, marginBottom: 6, width: '100%' }}
            />
            <button onClick={create} disabled={creating} className="btn btn-blue btn-full" style={{ fontSize: 10 }}>
              {creating ? 'CREATING...' : 'SET ALERT'}
            </button>
          </div>
        </>
      )}

      {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{err}</p>}
      <button onClick={onBack} className="btn btn-muted btn-full" style={{ fontSize: 9 }}>BACK</button>
    </div>
  );
}

/**
 * PositionList — wraps the position cards with attention-based sorting,
 * a collapsible calm group, and a one-time plan-coverage nudge. Designed
 * to scale from 1 to 100+ positions without becoming a wall of rows.
 */
function PositionList({ positions, totalValue, onRefresh, showToast }) {
  const [calmExpanded, setCalmExpanded] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // Annotate each position with status + score, then split into needs-attention
  // vs calm. Status is computed once per render — pure JS, fine at any scale.
  const annotated = positions.map(pos => ({ pos, status: computePositionStatus(pos, totalValue) }));
  const needsAttention = annotated
    .filter(a => a.status.status !== 'calm')
    .sort((a, b) => b.status.score - a.status.score);
  const calm = annotated.filter(a => a.status.status === 'calm');

  // Plan coverage — count positions WITHOUT a thesis/target/stop. Show one
  // consolidated nudge above the list when half or more of the book is
  // unplanned (only really matters at 4+ positions). No per-row nag.
  const unplanned = positions.filter(p => !p.entry_thesis && !p.price_target && !p.stop_loss);
  const showPlanNudge = !nudgeDismissed && positions.length >= 4 && unplanned.length >= positions.length / 2;

  // Auto-expand calm group when there are few of them — collapse only matters
  // when there's a real wall to hide.
  const collapseCalm = calm.length >= 5 && !calmExpanded;

  return (
    <div style={{ padding: '8px 16px 8px' }}>
      {/* Plan-coverage nudge — one consolidated message, dismissible */}
      {showPlanNudge && (
        <div style={{
          background: 'rgba(59,130,246,0.06)',
          border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 2 }}>
              {unplanned.length} of {positions.length} positions don't have a plan
            </p>
            <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4, margin: 0 }}>
              Set a target and stop on each — Outpost will hold you to them. Tap any position to add a plan.
            </p>
          </div>
          <button
            onClick={() => setNudgeDismissed(true)}
            aria-label="Dismiss"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--faint)', fontSize: 14, padding: '0 4px',
              fontFamily: 'inherit',
            }}
          >×</button>
        </div>
      )}

      {/* Needs-attention positions — always visible, sorted by score */}
      {needsAttention.map(({ pos, status }) => (
        <PositionCard
          key={pos.id}
          pos={pos}
          totalValue={totalValue}
          onRefresh={onRefresh}
          showToast={showToast}
          status={status}
        />
      ))}

      {/* Calm group — collapsed behind a divider once there are 5+. The
          divider tells the user there are positions below; the click expands. */}
      {collapseCalm && (
        <button
          onClick={() => setCalmExpanded(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%',
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '10px 12px',
            margin: '4px 0',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.5px', fontWeight: 600 }}>
            CALM — {calm.length} POSITIONS
          </span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>SHOW ▾</span>
        </button>
      )}

      {!collapseCalm && calm.map(({ pos, status }) => (
        <PositionCard
          key={pos.id}
          pos={pos}
          totalValue={totalValue}
          onRefresh={onRefresh}
          showToast={showToast}
          status={status}
        />
      ))}
    </div>
  );
}

/**
 * ThesisSection — always-visible block on the expanded position card.
 * Shows entry thesis + reversal condition + when it was written, with an
 * Edit link. Legacy positions (no thesis yet) get a quiet "Write one" CTA
 * so the absence isn't shaming — it's an invitation.
 */
function ThesisSection({ pos, onEdit, onReconfirmed }) {
  const hasEntry = !!(pos.entry_thesis && pos.entry_thesis.trim());
  const hasReversal = !!(pos.reversal_condition && pos.reversal_condition.trim());
  const hasAny = hasEntry || hasReversal;

  // "Written N days ago." Graceful degradation if the timestamp is missing.
  let ageLabel = null;
  let ageDays = null;
  if (pos.thesis_written_at) {
    const ms = Date.now() - new Date(pos.thesis_written_at).getTime();
    ageDays = Math.floor(ms / 86400000);
    if (ageDays <= 0) ageLabel = 'today';
    else if (ageDays === 1) ageLabel = '1 day ago';
    else if (ageDays < 30) ageLabel = `${ageDays} days ago`;
    else if (ageDays < 365) ageLabel = `${Math.floor(ageDays / 30)} mo ago`;
    else ageLabel = `${Math.floor(ageDays / 365)}y ago`;
  }

  // Thesis goes stale. After 90 days, the reasons you wrote down might not
  // match the world anymore (earnings happened, narratives moved, your own
  // conviction shifted). A soft nudge surfaces so the user can re-confirm
  // (touches thesis_written_at to now) or rewrite it. Not blocking. Not
  // shamey. Just a reminder that old conviction without a check-in is the
  // same as no conviction.
  const STALE_DAYS = 90;
  const thesisIsStale = hasEntry && ageDays != null && ageDays >= STALE_DAYS;

  async function reconfirmThesis() {
    try {
      // Explicit reconfirm flag bumps thesis_written_at server-side without
      // changing any text. The user re-affirmed their existing conviction.
      // Server handles the timestamp; we just refresh on success.
      await api.portfolio.editPosition(pos.id, { reconfirmThesis: true });
      if (typeof onReconfirmed === 'function') onReconfirmed();
    } catch {
      // Non-blocking. User can also use EDIT to re-confirm via the form.
    }
  }

  if (!hasAny) {
    return (
      <div
        onClick={onEdit}
        style={{
          background: 'rgba(59,130,246,0.04)',
          border: '1px dashed rgba(59,130,246,0.3)',
          borderRadius: 5,
          padding: '9px 11px',
          marginBottom: 10,
          cursor: 'pointer',
        }}
      >
        <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 3 }}>YOUR THESIS</p>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          You haven't written a thesis for this one yet. <span style={{ color: 'var(--blue)' }}>Write it →</span>
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--raised)',
      borderRadius: 5,
      padding: '8px 11px',
      marginBottom: 10,
      borderLeft: '2px solid var(--blue)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.6px' }}>
          YOUR THESIS {ageLabel && <span style={{ color: 'var(--faint)', fontWeight: 500, marginLeft: 4 }}>· written {ageLabel}</span>}
        </p>
        <button
          onClick={onEdit}
          style={{ fontSize: 9, color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', letterSpacing: '0.3px' }}
        >
          EDIT
        </button>
      </div>
      {hasEntry && (
        <div style={{ marginBottom: hasReversal ? 6 : 0 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>WHY</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>{pos.entry_thesis}</p>
        </div>
      )}
      {hasReversal && (
        <div>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>WHAT WOULD CHANGE YOUR MIND</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>{pos.reversal_condition}</p>
        </div>
      )}
      {!hasEntry && hasReversal && (
        <p style={{ fontSize: 9, color: 'var(--faint)', fontStyle: 'italic', marginTop: 6 }}>
          No entry thesis yet — <span style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={onEdit}>add one</span>.
        </p>
      )}
      {hasEntry && !hasReversal && (
        <p style={{ fontSize: 9, color: 'var(--faint)', fontStyle: 'italic', marginTop: 6 }}>
          No reversal condition yet. <span style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={onEdit}>Add one</span>.
        </p>
      )}

      {/* Thesis expiration nudge. 90+ days old thesis without a check-in
          surfaces a soft prompt. Re-confirm bumps thesis_written_at to now.
          Revise opens the edit form. Skips silently if the user does
          nothing. The visible reminder is the point. */}
      {thesisIsStale && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 5,
        }}>
          <p style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 4 }}>
            STALE THESIS · {ageDays}+ DAYS OLD
          </p>
          <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 6 }}>
            A lot has happened since you wrote this. Still believe it? Re-confirm or revise.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={reconfirmThesis}
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
                background: 'rgba(34,197,94,0.12)', color: 'var(--green)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              STILL TRUE
            </button>
            <button
              onClick={onEdit}
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
                background: 'rgba(59,130,246,0.12)', color: 'var(--blue)',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              REVISE IT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * HistorySection — Phase 3 contextual memory surfacing.
 * Quiet block on the expanded position card showing: first-bought date +
 * thesis snippet, past closed positions in the same ticker (with outcome),
 * recent agent chats about it. Hides entirely if no history exists.
 */
function HistorySection({ ticker, currentPositionId }) {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.portfolio.history(ticker, 8)
      .then(d => { if (!cancelled) setEvents(d.events || []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) return null;
  // Filter out the current position's own "opened" + "thesis" events — the
  // user is already looking at this position, no need to echo it back. Also
  // drop journal notes: they get their own roomier NOTES section right below,
  // so showing them here too would just duplicate them on the same card.
  // Keep prior closed positions in the same ticker and agent chats.
  const filtered = (events || []).filter(e =>
    !(e.id === `open:${currentPositionId}` || e.id === `thesis:${currentPositionId}`)
    && e.source !== 'journal'
  );
  if (filtered.length === 0) return null;

  // Collapse restatements: several events of the same source on this ticker are
  // usually the same idea repeated (the agent recommended it four times, say), so
  // the readable rows keep only the most recent of each source. The dot strip
  // below still shows the full density of every event, so nothing is hidden.
  const newestFirst = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));
  const seenSource = new Set();
  const rows = [];
  for (const e of newestFirst) {
    if (!seenSource.has(e.source)) { seenSource.add(e.source); rows.push(e); }
  }

  const strip = [...filtered].sort((a, b) => new Date(a.date) - new Date(b.date));
  const showStrip = strip.length >= 3;

  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.6px', marginBottom: 5, fontWeight: 700 }}>
        YOUR HISTORY WITH {ticker}
        {filtered.length > rows.length && (
          <span style={{ color: 'var(--faint)', fontWeight: 500, marginLeft: 6, letterSpacing: '0.3px' }}>
            · {filtered.length} events
          </span>
        )}
      </p>
      {showStrip && <HistoryDotStrip events={strip} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.slice(0, 4).map(e => <HistoryRow key={e.id} ev={e} />)}
      </div>
    </div>
  );
}

// Tiny horizontal strip of dots, one per history event, color by source.
// Glanceable density of your relationship with this stock. Older on the
// left, newer on the right. Hover tooltip shows the date + event type.
function HistoryDotStrip({ events }) {
  const dotColor = (source, outcome) => ({
    agent: '#a78bfa',
    position_open: 'var(--green)',
    position_close: outcome === 'win' ? 'var(--green)' : outcome === 'loss' ? 'var(--red)' : 'var(--amber)',
    thesis: 'var(--blue)',
    journal: 'var(--muted)',
    deploy_cash: '#38bdf8',
  })[source] || 'var(--faint)';

  const formatTooltip = (ev) => {
    const d = new Date(ev.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const labels = { agent: 'Chat', position_open: 'Opened', position_close: 'Closed', thesis: 'Thesis', journal: 'Note', deploy_cash: 'Deploy' };
    return `${dateStr} · ${labels[ev.source] || ev.source}`;
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '7px 9px', marginBottom: 7,
      background: 'var(--raised)', borderRadius: 4,
      overflowX: 'auto',
    }}>
      {events.map((ev) => (
        <div
          key={ev.id}
          title={formatTooltip(ev)}
          style={{
            flexShrink: 0,
            width: 8, height: 8, borderRadius: '50%',
            background: dotColor(ev.source, ev.outcome),
            opacity: 0.85,
            cursor: 'help',
          }}
        />
      ))}
    </div>
  );
}

function HistoryRow({ ev }) {
  const d = new Date(ev.date);
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  const label = ({
    agent: 'You asked',
    position_open: 'Opened',
    position_close: 'Closed',
    thesis: 'Wrote thesis',
    journal: 'Note',
  })[ev.source] || ev.source;
  const accent = ({
    agent: '#a78bfa',
    position_open: 'var(--green)',
    position_close: ev.outcome === 'win' ? 'var(--green)' : ev.outcome === 'loss' ? 'var(--red)' : 'var(--amber)',
    thesis: 'var(--blue)',
    journal: 'var(--muted)',
  })[ev.source] || 'var(--faint)';

  return (
    <div style={{
      background: 'var(--raised)',
      borderLeft: `2px solid ${accent}`,
      borderRadius: 4,
      padding: '6px 9px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ev.quote ? 3 : 0 }}>
        <span style={{ fontSize: 9, color: accent, fontWeight: 700, letterSpacing: '0.4px' }}>
          {label.toUpperCase()}
          {ev.source === 'position_close' && ev.pnl != null && (
            <span style={{ marginLeft: 5, color: ev.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {ev.pnl >= 0 ? '+' : ''}${Math.abs(ev.pnl).toFixed(0)}
            </span>
          )}
        </span>
        <span style={{ fontSize: 9, color: 'var(--faint)' }}>{dateLabel}</span>
      </div>
      {ev.quote && (
        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.45, fontStyle: 'italic' }}>
          "{ev.quote.length > 130 ? ev.quote.slice(0, 130) + '…' : ev.quote}"
        </p>
      )}
      {!ev.quote && ev.excerpt && (
        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.45 }}>
          {ev.excerpt.length > 130 ? ev.excerpt.slice(0, 130) + '…' : ev.excerpt}
        </p>
      )}
    </div>
  );
}

/**
 * NotesSection — the user's own journal notes that mention this ticker,
 * surfaced on the expanded position card. The whole point: when you open a
 * holding, the things you've already written about it are right there, instead
 * of buried in the Journal tab. Tap a note to read it in full inline.
 *
 * Matching happens server-side with the shared ticker tokenizer (whole-token,
 * ALL CAPS), so this only shows notes that genuinely reference the stock.
 * Hides entirely when there are none. These notes are the user's private
 * writing — the agent never reads them; this just shows them back to you.
 */
function NotesSection({ ticker }) {
  const [notes, setNotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [fullById, setFullById] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Cache per ticker so re-expanding a card doesn't refetch. 5-min TTL is
    // plenty — notes change rarely relative to how often cards get opened.
    cachedFetch(`notes_by_ticker_${ticker}`, () => api.journal.notesByTicker(ticker), 5 * 60000)
      .then(d => { if (!cancelled) setNotes(d.notes || []); })
      .catch(() => { if (!cancelled) setNotes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  async function toggle(note) {
    if (openId === note.id) { setOpenId(null); return; }
    setOpenId(note.id);
    // Lazy-load the full body only when a note is opened and not cached yet.
    // The list payload only carries a 220-char preview to stay small.
    if (fullById[note.id] === undefined) {
      try {
        const { note: full } = await api.journal.getNote(note.id);
        setFullById(prev => ({ ...prev, [note.id]: full?.content ?? '' }));
      } catch {
        setFullById(prev => ({ ...prev, [note.id]: null }));
      }
    }
  }

  if (loading) return null;
  if (!notes || notes.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.6px', marginBottom: 5, fontWeight: 700 }}>
        YOUR NOTES ON {ticker}
        {notes.length > 1 && (
          <span style={{ color: 'var(--faint)', fontWeight: 500, marginLeft: 6, letterSpacing: '0.3px' }}>
            · {notes.length}
          </span>
        )}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {notes.map(n => {
          const isOpen = openId === n.id;
          const full = fullById[n.id];
          const when = noteTimeAgo(n.updated_at);
          return (
            <div
              key={n.id}
              onClick={() => toggle(n)}
              style={{
                background: 'var(--raised)',
                borderLeft: '2px solid var(--muted)',
                borderRadius: 4,
                padding: '6px 9px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.title || 'Untitled'}
                </span>
                <span style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>{when}</span>
              </div>
              {isOpen ? (
                <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
                  {full === undefined ? 'Loading…' : full === null ? (n.preview || '') : (full || '(empty note)')}
                </p>
              ) : (
                n.preview ? (
                  <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {n.preview}
                  </p>
                ) : null
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compact relative time for note rows. Mirrors the Journal tab's timeAgo but
// kept local so PortfolioTab doesn't take a dependency on JournalTab internals.
function noteTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Position health: the reflective verdict on whether a holding still earns its
// place. Shown under the thesis on the expanded card. Distinct from the
// attention badge, this is thesis-aware and frames the holding against the
// trader's journey, not just today's price.
const HEALTH_STYLE = {
  on_track:   { label: 'ON TRACK',   color: 'var(--green)', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)' },
  watch:      { label: 'WATCH',      color: 'var(--amber)', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
  reconsider: { label: 'RECONSIDER', color: 'var(--red)',   bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)' },
};
function HealthRead({ pos }) {
  const h = assessPositionHealth(pos);
  const s = HEALTH_STYLE[h.status] || HEALTH_STYLE.watch;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 12px', margin: '6px 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', color: s.color }}>{s.label}</span>
        <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>POSITION HEALTH</span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55, margin: 0 }}>{h.reason}</p>
    </div>
  );
}

function PositionCard({ pos, totalValue, onRefresh, showToast, status }) {
  // Modes:
  //   'collapsed' — compact card showing price + today + P&L
  //   'expanded'  — opened card showing details + news + GET AI READ button
  //   'edit'      — edit form (shares, avgCost, thesis, target, stop, notes)
  //   'close'     — close-position confirmation with exit reflection
  const [mode, setMode] = useState('collapsed');

  // AI read state — fetched lazily when the user taps "GET AI READ"
  const [aiRead, setAiRead] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCached, setAiCached] = useState(false);

  // Free news headlines for the expanded view (no AI summary, no credits)
  const [news, setNews] = useState(null); // null = not yet fetched, [] = none, [...] = articles
  const [newsLoading, setNewsLoading] = useState(false);

  const [editForm, setEditForm] = useState({
    shares: String(pos.shares),
    avgCost: String(pos.avg_cost ?? ''),
    entryThesis: pos.entry_thesis || '',
    reversalCondition: pos.reversal_condition || '',
    priceTarget: pos.price_target ? String(pos.price_target) : '',
    stopLoss: pos.stop_loss ? String(pos.stop_loss) : '',
    tradeNotes: pos.trade_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sellPrice, setSellPrice] = useState('');
  // Phase 2 close-time reflection — three structured fields.
  // Legacy fields (exitReflection text + exitOutcome enum) are derived
  // server-side from these so the agent's existing tools keep working.
  const [thesisPlayedOut, setThesisPlayedOut] = useState(null); // 'yes' | 'partially' | 'no'
  const [reflectionWhatHappened, setReflectionWhatHappened] = useState('');
  const [reflectionLesson, setReflectionLesson] = useState('');
  // Execution rating 1-5. The CONTROLLABLE half of the close reflection.
  // Outcome (thesisPlayedOut) is luck-contaminated. Execution is the skill
  // metric. Patterns view tracks both separately so the user can see if
  // their high-execution trades have a better win rate than their low.
  const [executionRating, setExecutionRating] = useState(null);
  const [skipReflectionConfirm, setSkipReflectionConfirm] = useState(false);
  const [err, setErr] = useState('');
  const [journalSave, setJournalSave] = useState(null);

  const hasPlan = pos.entry_thesis || pos.price_target || pos.stop_loss;
  const pnlPct = pos.avg_cost > 0 && pos.currentPrice
    ? ((pos.currentPrice - pos.avg_cost) / pos.avg_cost) * 100
    : 0;
  const inDrawdown = pnlPct <= -20;

  // Fetch headlines lazily the first time the card expands. Free (no credits).
  async function loadNewsIfNeeded() {
    if (news !== null || newsLoading) return;
    setNewsLoading(true);
    try {
      const d = await api.portfolio.stockDetails(pos.ticker);
      setNews((d?.news || []).slice(0, 3));
    } catch { setNews([]); }
    setNewsLoading(false);
  }

  function expand() {
    setMode('expanded');
    loadNewsIfNeeded();
  }

  // The deliberate AI call. Cached server-side per (user, ticker, day) so
  // tapping again later that day doesn't re-charge credits.
  async function getAIRead() {
    setAiLoading(true); setErr('');
    try {
      const d = await api.ai.analysis(pos.ticker, false, false);
      setAiRead(d.analysis);
      setAiCached(!!d.cached);
    } catch (e) {
      setErr(e.error || 'Read unavailable');
    }
    setAiLoading(false);
  }
  async function getDeepRead() {
    setAiLoading(true); setErr('');
    try {
      const d = await api.ai.analysis(pos.ticker, true, false);
      setAiRead(d.analysis);
      setAiCached(!!d.cached);
    } catch (e) {
      setErr(e.error || 'Deep read unavailable');
    }
    setAiLoading(false);
  }

  async function saveEdit() {
    const shares = parseFloat(editForm.shares);
    const avgCost = parseFloat(editForm.avgCost);
    if (isNaN(shares) || shares <= 0) { setErr('Shares must be a positive number'); return; }
    if (editForm.avgCost && (isNaN(avgCost) || avgCost < 0)) { setErr('Average cost must be a valid number'); return; }
    setSaving(true); setErr('');
    try {
      const body = {
        shares,
        avgCost: isNaN(avgCost) ? 0 : avgCost,
        entryThesis: editForm.entryThesis || '',
        reversalCondition: editForm.reversalCondition || '',
        priceTarget: editForm.priceTarget ? parseFloat(editForm.priceTarget) : null,
        stopLoss: editForm.stopLoss ? parseFloat(editForm.stopLoss) : null,
        tradeNotes: editForm.tradeNotes || '',
      };
      await api.portfolio.editPosition(pos.id, body);
      setMode('collapsed'); onRefresh();
      showToast(`${pos.ticker} updated`, 'success');
    } catch (e) { setErr(e.error || 'Failed to save'); }
    setSaving(false);
  }

  function attemptClose() {
    // Soft gate: if NOTHING was filled in (no thesis-played-out, no reflection,
    // no execution rating), prompt before closing. Skipping is still allowed.
    if (!thesisPlayedOut && !reflectionWhatHappened.trim() && !reflectionLesson.trim() && executionRating == null) {
      setSkipReflectionConfirm(true);
      return;
    }
    doRemove();
  }

  async function doRemove() {
    setSkipReflectionConfirm(false);
    setRemoving(true); setErr('');
    try {
      const body = {};
      if (sellPrice) body.sellPrice = parseFloat(sellPrice);
      if (thesisPlayedOut) body.thesisPlayedOut = thesisPlayedOut;
      if (reflectionWhatHappened.trim()) body.reflectionWhatHappened = reflectionWhatHappened.trim();
      if (reflectionLesson.trim()) body.reflectionLesson = reflectionLesson.trim();
      if (executionRating != null) body.executionRating = executionRating;
      await api.portfolio.removePosition(pos.id, body);
      onRefresh();
      showToast(`${pos.ticker} closed and saved to history`, 'success');
    } catch {
      setErr('Failed to remove');
      setRemoving(false);
    }
  }

  // Border accent — drawdown amber wins, otherwise green/red by today's P&L
  // Accent comes from the position's attention status when set (badges + sort
  // know about this); fallback to the legacy drawdown/pnl color when not.
  const accentColor = status?.badgeColor ?? (inDrawdown ? 'var(--amber)' : colorFor(pos.pnl));
  const concentrationHigh = (status?.concentration ?? 0) >= 25;

  return (
    <>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${accentColor}`,
        borderRadius: 8,
        marginBottom: 8,
        overflow: 'hidden',
      }}>
        {/* Slim collapsed header — ticker, today's price + change, P&L. Tap to expand. */}
        <div style={{ padding: '11px 13px', cursor: 'pointer' }} onClick={() => mode === 'collapsed' ? expand() : setMode('collapsed')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{pos.ticker}</span>
              {/* Attention badge — only shown for non-calm statuses. Color
                  matches the row accent so the user can scan the list and
                  immediately see what needs them. */}
              {status?.badgeLabel && (
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: `${status.badgeColor === 'var(--red)' ? 'rgba(239,68,68,0.15)'
                    : status.badgeColor === 'var(--green)' ? 'rgba(34,197,94,0.15)'
                    : 'rgba(245,158,11,0.15)'}`,
                  color: status.badgeColor,
                  border: `1px solid ${status.badgeColor === 'var(--red)' ? 'rgba(239,68,68,0.3)'
                    : status.badgeColor === 'var(--green)' ? 'rgba(34,197,94,0.3)'
                    : 'rgba(245,158,11,0.3)'}`,
                  letterSpacing: '0.4px',
                }}>
                  {status.badgeLabel}
                </span>
              )}
              {/* Concentration warning chip — fires when a single position is
                  ≥25% of the book. Advisor-style nudge, not an alert. */}
              {concentrationHigh && (
                <span
                  title={`${status.concentration.toFixed(0)}% of your portfolio — heavy concentration`}
                  style={{
                    fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(168,85,247,0.12)',
                    color: '#a78bfa',
                    border: '1px solid rgba(168,85,247,0.3)',
                    letterSpacing: '0.4px',
                  }}
                >
                  {status.concentration.toFixed(0)}% OF BOOK
                </span>
              )}
              <EarningsBadge earnings={pos.earnings} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: pos.priceStale ? 'var(--faint)' : 'var(--text)', letterSpacing: '-0.2px' }}>
                ${fmt(pos.currentPrice)}
              </span>
              {pos.priceStale && <span style={{ fontSize: 8, color: 'var(--amber)', marginLeft: 4 }}>NO PRICE</span>}
              <span style={{ fontSize: 11, fontWeight: 700, color: colorFor(pos.todayChangePercent), marginLeft: 6, letterSpacing: '-0.1px' }}>
                {pos.todayChangePercent >= 0 ? '+' : ''}{fmt(pos.todayChangePercent)}%
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
            <span style={{ color: colorFor(pos.pnl), fontWeight: 700 }}>
              {pos.pnl >= 0 ? '+' : ''}${fmt(pos.pnl)}
              <span style={{ color: 'var(--faint)', fontWeight: 400, marginLeft: 4 }}>({pos.pnlPercent >= 0 ? '+' : ''}{fmt(pos.pnlPercent)}%)</span>
            </span>
            <span style={{ color: 'var(--faint)', fontSize: 13 }}>{mode === 'collapsed' ? '›' : '⌃'}</span>
          </div>
        </div>

        {/* Expanded — position details + free news + lazy AI read button */}
        {mode === 'expanded' && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 13px' }}>
            {/* Today's driver — first line a user reads when they open a
                position. Uses the top news headline when present, falls back
                to a calm framing line when news is empty. Works in concert
                with the lazy news fetch (loadNewsIfNeeded ran on expand). */}
            {/* YOUR THESIS. Lead element on expansion. The user's own words
                are the centerpiece of every Outpost position, not the news of
                the day. The thesis was the reason they bought. It is what they
                need to re-read first before anything else. */}
            <ThesisSection
              pos={pos}
              onEdit={() => setMode('edit')}
              onReconfirmed={onRefresh}
            />

            {/* POSITION HEALTH — the honest verdict on whether this holding still
                earns its place. Suppressed when it would only restate the attention
                badge (below stop / at target); the thesis-aware verdicts (no thesis,
                down-but-thesis, on track) still show, since those say what the badge
                cannot. Stops the "BELOW STOP" / "RECONSIDER · Below the stop" double. */}
            {(() => {
              const live = pos.currentPrice;
              const belowStop = pos.stop_loss > 0 && live && live <= pos.stop_loss;
              const atTarget = pos.price_target > 0 && live && live >= pos.price_target;
              return (belowStop || atTarget) ? null : <HealthRead pos={pos} />;
            })()}

            {/* TODAY'S DRIVER. The fresh context after the thesis. Why did
                this stock move today, in one line. Sits below the thesis so
                the user reads their conviction first, then the news second. */}
            {/* Only show TODAY'S DRIVER when there's an actual headline. An empty
                "no news" line on every quiet stock read as broken and added
                nothing; the AI breakdown below already pulls news on demand. */}
            {(newsLoading || news?.length > 0) && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.6px', marginBottom: 3, fontWeight: 600 }}>TODAY'S DRIVER</p>
                {newsLoading ? (
                  <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, fontStyle: 'italic' }}>Checking news…</p>
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.45 }}>{news[0].title || news[0].headline}</p>
                )}
              </div>
            )}

            {/* Phase 3 YOUR HISTORY. Past chats and prior closed positions in
                the same ticker. Journal notes are split out into their own
                NOTES section below. Hides entirely when there's no history. */}
            <HistorySection ticker={pos.ticker} currentPositionId={pos.id} />

            {/* YOUR NOTES — journal notes that mention this ticker, tap to read
                in full. Hides entirely when there are none. */}
            <NotesSection ticker={pos.ticker} />

            {/* Price levels (target/stop) — only rendered when at least one
                level is set. Thesis is shown above in its own ThesisSection so
                it isn't duplicated here. The empty-state CTA below only fires
                when BOTH levels are missing — having a thesis alone shouldn't
                hide the "add price levels" nudge. */}
            {(pos.price_target || pos.stop_loss) ? (
              <div style={{ background: 'var(--raised)', borderRadius: 5, padding: '7px 10px', marginBottom: 10, borderLeft: '2px solid var(--blue)' }}>
                <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 4 }}>PRICE LEVELS</p>
                <div style={{ display: 'flex', gap: 12, fontSize: 9 }}>
                  {pos.price_target && (
                    <span>
                      <span style={{ color: 'var(--faint)' }}>Target </span>
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>${fmt(pos.price_target)}</span>
                      {pos.currentPrice && pos.price_target > pos.currentPrice && (
                        <span style={{ color: 'var(--faint)', marginLeft: 3 }}>
                          ({(((pos.price_target - pos.currentPrice) / pos.currentPrice) * 100).toFixed(1)}% away)
                        </span>
                      )}
                    </span>
                  )}
                  {pos.stop_loss && (
                    <span>
                      <span style={{ color: 'var(--faint)' }}>Stop </span>
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>${fmt(pos.stop_loss)}</span>
                      {pos.currentPrice && pos.stop_loss < pos.currentPrice && (
                        <span style={{ color: 'var(--faint)', marginLeft: 3 }}>
                          ({(((pos.currentPrice - pos.stop_loss) / pos.currentPrice) * 100).toFixed(1)}% above)
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setMode('edit')}
                style={{
                  width: '100%',
                  background: 'rgba(59,130,246,0.04)',
                  border: '1px dashed rgba(59,130,246,0.3)',
                  borderRadius: 5,
                  padding: '8px 10px',
                  marginBottom: 10,
                  color: 'var(--blue)',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                + Add a plan — Outpost will hold you to your target and stop.
              </button>
            )}

            {/* Position details — moved below the plan since they're context,
                not the lead. Small / faint so they don't compete for attention. */}
            <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--faint)', marginBottom: 10 }}>
              <span>{pos.shares} shares</span>
              <span>avg ${fmt(pos.avg_cost)}</span>
              {totalValue > 0 && pos.currentValue > 0 && (
                <span>{fmt((pos.currentValue / totalValue) * 100, 1)}% of portfolio</span>
              )}
            </div>


            {/* AI read — opt-in, charges credits ONLY on fresh fetch.
                Cached server-side per (user, ticker, day) so subsequent taps
                that day are free. */}
            {/* AI read, only once fetched — the quick "should I worry about
                today's move" take, shown inline. The button to fetch it now lives
                in the secondary row below, so it does not compete with RESEARCH. */}
            {aiRead && (
              <div style={{ background: 'var(--raised)', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.8px' }}>
                    AI READ {aiCached && <span style={{ color: 'var(--faint)', fontWeight: 400, marginLeft: 4 }}>· cached</span>}
                  </span>
                  <BookmarkButton onClick={() => setJournalSave({ content: `${pos.ticker} — AI read\n\n${aiRead}` })} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.65, marginBottom: 8 }}>{renderPlainText(aiRead)}</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={getDeepRead} disabled={aiLoading} className="btn btn-purple" style={{ flex: 1, fontSize: 10, padding: '6px 0' }}>
                    {aiLoading ? '...' : 'GO DEEPER'}
                  </button>
                </div>
                <FeedbackButtons feature="analysis" response={aiRead} />
              </div>
            )}

            {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{err}</p>}

            {/* ONE clear way in: RESEARCH opens the full holding dossier — your
                position, the company research (what they do, fundamentals,
                momentum, news, the Street), and a deep dive into the agent that
                already knows you hold it. That single surface replaced the old
                pile of competing AI buttons. */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('research_open', { detail: { ticker: pos.ticker } }))}
              className="btn btn-blue btn-full"
              style={{ fontSize: 11.5, padding: '10px 0', marginBottom: 8 }}
            >RESEARCH {pos.ticker} →</button>

            {/* Secondary row: a quick inline AI read, and the manage actions. */}
            <div style={{ display: 'flex', gap: 6 }}>
              {!aiRead && (
                <button onClick={getAIRead} disabled={aiLoading} className="btn btn-muted" style={{ flex: 1.4, fontSize: 10, padding: '7px 0' }}>
                  {aiLoading ? 'Reading…' : "Quick read on today's move"}
                </button>
              )}
              <button onClick={() => setMode('edit')} className="btn btn-muted" style={{ flex: 1, fontSize: 10, padding: '7px 0' }}>EDIT</button>
              <button
                onClick={() => { setSellPrice(pos.currentPrice ? String(pos.currentPrice) : ''); setMode('close'); }}
                className="btn btn-red"
                style={{ flex: 1, fontSize: 10, padding: '7px 0' }}
              >CLOSE</button>
            </div>
          </div>
        )}

        {/* Close-trade form — Phase 2 structured reflection.
            Three fields feed the accountability loop:
              1. thesisPlayedOut (yes/partially/no) — tap selection
              2. reflectionWhatHappened — narrative, AI-assisted
              3. reflectionLesson — takeaway, AI-assisted
            Soft-skip allowed; the SkipThesisModal makes the choice explicit. */}
        {mode === 'close' && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 13px' }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', marginBottom: 8 }}>CLOSE {pos.ticker} POSITION</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: 'var(--faint)', whiteSpace: 'nowrap' }}>Sell price $</span>
              <input className="input" type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} style={{ flex: 1, fontSize: 12 }} placeholder={String(pos.currentPrice ?? '')} />
            </div>

            {/* Question 1 — did the thesis play out? Single tap. */}
            <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '0.5px', marginBottom: 5, fontWeight: 700 }}>DID YOUR THESIS PLAY OUT?</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 12 }}>
              {[
                { id: 'yes', label: 'Yes' },
                { id: 'partially', label: 'Partially' },
                { id: 'no', label: 'No' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setThesisPlayedOut(o => o === opt.id ? null : opt.id)}
                  className={`btn ${thesisPlayedOut === opt.id ? 'btn-blue' : 'btn-muted'}`}
                  style={{ fontSize: 10, padding: '7px 0' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Question 2 — what happened. AI-assisted. */}
            <ThesisAssistField
              label="WHAT HAPPENED?"
              placeholder="The story of this trade — what played out, what didn't."
              value={reflectionWhatHappened}
              onChange={setReflectionWhatHappened}
              rows={3}
              assist={async (current) => {
                const computedPnl = sellPrice && pos.avg_cost
                  ? (parseFloat(sellPrice) - pos.avg_cost) * pos.shares
                  : pos.pnl;
                const computedPnlPct = sellPrice && pos.avg_cost
                  ? ((parseFloat(sellPrice) - pos.avg_cost) / pos.avg_cost) * 100
                  : pos.pnlPercent;
                const d = await api.ai.exitReflectionAssist({
                  ticker: pos.ticker,
                  field: 'what_happened',
                  entryThesis: pos.entry_thesis || '',
                  reversalCondition: pos.reversal_condition || '',
                  pnl: computedPnl,
                  pnlPercent: computedPnlPct,
                  thesisPlayedOut,
                });
                return d.draft;
              }}
            />

            {/* Question 3 — the lesson for next time. AI-assisted. */}
            <ThesisAssistField
              label="WHAT DID YOU LEARN FOR NEXT TIME?"
              placeholder="One concrete takeaway you want to remember."
              value={reflectionLesson}
              onChange={setReflectionLesson}
              rows={3}
              assist={async (current) => {
                const computedPnl = sellPrice && pos.avg_cost
                  ? (parseFloat(sellPrice) - pos.avg_cost) * pos.shares
                  : pos.pnl;
                const computedPnlPct = sellPrice && pos.avg_cost
                  ? ((parseFloat(sellPrice) - pos.avg_cost) / pos.avg_cost) * 100
                  : pos.pnlPercent;
                const d = await api.ai.exitReflectionAssist({
                  ticker: pos.ticker,
                  field: 'lesson',
                  entryThesis: pos.entry_thesis || '',
                  reversalCondition: pos.reversal_condition || '',
                  pnl: computedPnl,
                  pnlPercent: computedPnlPct,
                  thesisPlayedOut,
                });
                return d.draft;
              }}
            />

            {/* Execution rating. The CONTROLLABLE half of this reflection.
                Thesis playing out is about outcome (partially luck). This
                question is about execution. Did you follow your own plan, or
                did you panic, hold too long, fat-finger something. Five
                buttons, 1 to 5. Optional. Surfaces in the Patterns view as
                its own row plus "win rate when execution was 4-5 vs 1-2."
                Different from outcome on purpose. Skill, not luck. */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '0.5px', marginBottom: 4, fontWeight: 700 }}>HOW WELL DID YOU EXECUTE?</p>
              <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 7, lineHeight: 1.5 }}>
                Not the outcome. The execution. Did you follow your own plan? 1 is panic, 5 is exactly what you said you'd do.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                {[1, 2, 3, 4, 5].map(n => {
                  const on = executionRating === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setExecutionRating(on ? null : n)}
                      style={{
                        padding: '9px 0',
                        background: on ? 'rgba(59,130,246,0.18)' : 'var(--raised)',
                        border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
                        borderRadius: 6,
                        color: on ? 'var(--blue)' : 'var(--text)',
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--faint)' }}>panicked</span>
                <span style={{ fontSize: 9, color: 'var(--faint)' }}>nailed it</span>
              </div>
            </div>

            {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{err}</p>}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setMode('expanded')} className="btn btn-muted" style={{ flex: 1 }}>CANCEL</button>
              <button onClick={attemptClose} disabled={removing} className="btn btn-red" style={{ flex: 1 }}>{removing ? '...' : 'CONFIRM CLOSE'}</button>
            </div>
          </div>
        )}

        {/* Edit form */}
        {mode === 'edit' && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 13px' }}>
            <FormField label="Shares"><input className="input" type="number" value={editForm.shares} onChange={e => setEditForm(f => ({ ...f, shares: e.target.value }))} /></FormField>
            <FormField label="Avg Cost"><input className="input" type="number" value={editForm.avgCost} onChange={e => setEditForm(f => ({ ...f, avgCost: e.target.value }))} /></FormField>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4, marginBottom: 4 }}>
              <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>YOUR THESIS</p>
              <ThesisAssistField
                label="WHY ARE YOU HOLDING THIS?"
                placeholder="What's the story here? Why this stock, why now?"
                value={editForm.entryThesis}
                onChange={v => setEditForm(f => ({ ...f, entryThesis: v }))}
                rows={3}
                assist={async (current) => {
                  const d = await api.ai.thesisAssist({ ticker: pos.ticker, field: 'entry', userNote: current });
                  return d.draft;
                }}
              />
              <ThesisAssistField
                label="WHAT WOULD MAKE YOU CHANGE YOUR MIND?"
                placeholder="What would have to happen for you to sell or cut your losses?"
                value={editForm.reversalCondition}
                onChange={v => setEditForm(f => ({ ...f, reversalCondition: v }))}
                rows={3}
                assist={async (current) => {
                  const d = await api.ai.thesisAssist({ ticker: pos.ticker, field: 'reversal', userNote: current });
                  return d.draft;
                }}
              />
              <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginTop: 8, marginBottom: 6 }}>PRICE LEVELS (OPTIONAL)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <FormField label="Price Target $"><input className="input" type="number" placeholder="0.00" value={editForm.priceTarget} onChange={e => setEditForm(f => ({ ...f, priceTarget: e.target.value }))} /></FormField>
                <FormField label="Stop Loss $"><input className="input" type="number" placeholder="0.00" value={editForm.stopLoss} onChange={e => setEditForm(f => ({ ...f, stopLoss: e.target.value }))} /></FormField>
              </div>
              <FormField label="Notes"><input className="input" placeholder="Any additional notes..." value={editForm.tradeNotes} onChange={e => setEditForm(f => ({ ...f, tradeNotes: e.target.value }))} /></FormField>
            </div>

            {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{err}</p>}
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={() => setMode('expanded')} className="btn btn-muted" style={{ flex: 1 }}>CANCEL</button>
              <button onClick={saveEdit} disabled={saving} className="btn btn-blue" style={{ flex: 1 }}>{saving ? 'SAVING...' : 'SAVE'}</button>
            </div>
          </div>
        )}
      </div>

      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        showToast={showToast}
      />

      {skipReflectionConfirm && (
        <SkipThesisModal
          kind="reflection"
          onWrite={() => setSkipReflectionConfirm(false)}
          onSkip={doRemove}
        />
      )}
    </>
  );
}

// First-run aha: the instant AI read shown right after a user's very first
// position is added, so the app proves itself in seconds instead of making them
// hunt for the read three taps deep. Degrades quietly if the account isn't
// entitled or the call fails, so it never breaks the first moment.
function FirstReadSheet({ ticker, onClose }) {
  const [read, setRead] = useState(null);
  const [disc, setDisc] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.ai.analysis(ticker, false, false);
        if (cancelled) return;
        if (d?.analysis) { setRead(d.analysis); setDisc(d.disclaimer || ''); }
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker]);

  return (
    <Modal title={`Your first read: ${ticker}`} onClose={onClose}>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0' }}>
          <Spinner />
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Reading {ticker} for you...</p>
        </div>
      )}
      {!loading && read && (
        <>
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, marginBottom: 12 }}>{renderPlainText(read)}</p>
          {disc && <p style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 14 }}>{disc}</p>}
        </>
      )}
      {!loading && failed && (
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: '6px 0 14px' }}>
          {ticker} is in your portfolio. Open its card any time and tap Get AI Read for the full take.
        </p>
      )}
      <button onClick={onClose} className="btn btn-blue btn-full">Done</button>
    </Modal>
  );
}

// Stress test: what a drop would actually cost you, in dollars. Collapsed by
// default so it informs without crowding. Honest about its assumption (holdings
// moving with the market) since we don't model per-stock beta yet.
// How exposed are you: the dollar stress tests AND the sector mix in one collapsed
// block. Both answer the same question ("how concentrated and fragile is my book")
// and both read the same portfolio_sectors data, so they live together as two
// labeled parts instead of two separate sections that say overlapping things.
function ExposureCard({ positions, onTabSwitch }) {
  const [open, setOpen] = useState(false);
  const [beta, setBeta] = useState(1);
  const [exposure, setExposure] = useState(null);
  useEffect(() => {
    let cancelled = false;
    cachedFetch('portfolio_sectors', () => api.portfolio.sectors(), 5 * 60000)
      .then(d => {
        if (cancelled) return;
        const holdings = d?.holdings || [];
        const hs = holdings.filter(h => Number.isFinite(h.beta) && h.value > 0);
        const tv = hs.reduce((s, h) => s + h.value, 0);
        if (tv > 0) setBeta(hs.reduce((s, h) => s + h.value * h.beta, 0) / tv);
        setExposure(sectorExposure(holdings));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const scenarios = buildStressTests(positions, { portfolioBeta: beta });
  const sectors = exposure?.sectors || [];
  const top = sectors.slice(0, 6);
  const gaps = exposure ? sectorGaps(sectors) : { gaps: [] };
  const showGaps = gaps.gaps.length > 0 && (exposure?.concentrated || sectors.length <= 3);
  if (scenarios.length === 0 && sectors.length === 0) return null;

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', fontFamily: 'inherit' }}
      >
        <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', textTransform: 'uppercase' }}>How exposed are you</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {exposure?.concentrated && <span style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700 }}>{exposure.top.sector} {exposure.top.pct}%</span>}
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          {scenarios.length > 0 && (
            <>
              <p style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.8px', margin: '0 0 8px' }}>IF THE MARKET TURNS</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: sectors.length ? 16 : 0 }}>
                {scenarios.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 12, color: 'var(--text)', margin: 0 }}>{s.label}</p>
                      <p style={{ fontSize: 9, color: 'var(--faint)', margin: '2px 0 0', lineHeight: 1.4 }}>{s.note}</p>
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <p style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, margin: 0 }}>-${Math.abs(s.impact).toLocaleString()}</p>
                      <p style={{ fontSize: 9, color: 'var(--faint)', margin: 0 }}>{s.pct}%</p>
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: 9, color: 'var(--faint)', lineHeight: 1.5, marginTop: 2 }}>Rough estimates. Markets do not move in straight lines, and this assumes your holdings track the market.</p>
              </div>
            </>
          )}
          {sectors.length > 0 && (
            <>
              <p style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.8px', margin: '0 0 8px' }}>SECTOR MIX</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {top.map(s => (
                  <div key={s.sector}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: 'var(--text)' }}>{s.sector}</span>
                      <span style={{ color: 'var(--muted)' }}>{s.pct}%</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, s.pct)}%`, height: '100%', background: 'var(--blue)', borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
                {exposure.concentrated && (
                  <p style={{ fontSize: 10, color: 'var(--amber)', lineHeight: 1.5, marginTop: 4 }}>
                    {exposure.top.pct}% of your book is in {exposure.top.sector}. One sector turning can swing the whole thing.
                  </p>
                )}
                {showGaps && (
                  <div style={{ marginTop: exposure.concentrated ? 8 : 4 }}>
                    <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 6 }}>
                      Light or missing. Tap one and Outpost will find a name to round it out:
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {gaps.gaps.map(sec => (
                        <button
                          key={sec}
                          onClick={() => {
                            try { window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message: `Find me one quality ${sec} name to diversify into. I have little or no exposure to ${sec} right now and want to round out my book.` } })); } catch {}
                            onTabSwitch?.('agent');
                          }}
                          className="btn btn-muted"
                          style={{ fontSize: 10, padding: '4px 10px' }}
                        >
                          {sec}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// "WHAT NEEDS YOU" — the prioritized, proactive action list. The few decisions
// that actually matter on your book today, each with one button to act on it.
// Renders nothing when the book is calm and fully planned, so it is signal only.
function ActionFeed({ positions, totalValue }) {
  const actions = buildPortfolioActions(positions, totalValue);
  if (!actions.length) return null;
  const act = (a) => {
    if (a.actionType === 'ask') window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message: a.askMessage } }));
    else window.dispatchEvent(new CustomEvent('research_open', { detail: { ticker: a.ticker } }));
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'rgba(59,130,246,0.04)' }}>
      <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--blue)', letterSpacing: '1px', padding: '10px 16px 2px', margin: 0 }}>WHAT NEEDS YOU</p>
      {actions.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: '1px solid var(--border)' }}>
          <p style={{ flex: 1, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.45, margin: 0 }}>{a.text}</p>
          <button onClick={() => act(a)} className="btn btn-blue" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '6px 11px', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.actionLabel}</button>
        </div>
      ))}
    </div>
  );
}

// "ON YOUR BOOK" — recent headlines across the user's holdings, newest first,
// tagged with each name's move today so the biggest movers and their likely
// reason surface together. Tap a row to research that company. Stays quiet (renders
// nothing) when there is no news, so it never reads as a broken empty section.
function DevelopmentsCard() {
  const [items, setItems] = useState(null); // null = loading, [] = none
  useEffect(() => {
    let alive = true;
    api.portfolio.developments().then(d => { if (alive) setItems(d.items || []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 8 }}>ON YOUR BOOK</p>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {items.map((n, i) => (
          <div key={i}
            onClick={() => window.dispatchEvent(new CustomEvent('research_open', { detail: { ticker: n.ticker } }))}
            title={`Research ${n.ticker}`}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <div style={{ flexShrink: 0, width: 46 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{n.ticker}</span>
              {n.changePercent != null && (
                <div style={{ fontSize: 9, fontWeight: 700, color: n.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {n.changePercent >= 0 ? '+' : ''}{Number(n.changePercent).toFixed(1)}%
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.4, margin: 0 }}>{n.title}</p>
              <p style={{ fontSize: 9, color: 'var(--faint)', margin: '2px 0 0' }}>{n.source}{n.published ? ` · ${devTimeAgo(n.published)}` : ''}</p>
            </div>
            <span style={{ fontSize: 9, color: 'var(--blue)', flexShrink: 0, alignSelf: 'center' }}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function devTimeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

function PortfolioSubTab({ marketOpen, showToast, onTabSwitch }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // 'add' | 'import' | 'menu' | 'closed' | 'theses' | null
  const [showGrowth, setShowGrowth] = useState(false);
  // Phase 4 — when the user picks a Deploy Cash recommendation, the Home
  // card dispatches 'deploy_cash_pick' + switches to Portfolio. We catch
  // the event here and open AddModal with the recommendation pre-filled.
  const [addPrefill, setAddPrefill] = useState(null);
  // First-ever position triggers a one-time instant AI read (first-run aha).
  const [firstRead, setFirstRead] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.portfolio.value(); setData(d); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Phase 4 deploy-cash pick handler — open AddModal pre-filled with the
  // chosen recommendation's ticker, shares, cost, and reasoning (the bridge
  // to Phase 2 thesis capture). Records the choice + executed position id
  // back on the session via the choice endpoint after the user confirms.
  useEffect(() => {
    function onPick(e) {
      const opt = e?.detail?.option;
      const sessionId = e?.detail?.sessionId;
      if (!opt?.ticker) return;
      setAddPrefill({
        ticker: opt.ticker,
        companyName: opt.company_name || '',
        shares: opt.estimated_shares != null ? String(opt.estimated_shares) : '',
        avgCost: opt.ticker && opt.estimated_cost && opt.estimated_shares
          ? (opt.estimated_cost / opt.estimated_shares).toFixed(2)
          : '',
        // The recommendation's reasoning becomes the user's starting thesis.
        // They can edit, accept, or rewrite — friend-voice draft already done.
        entryThesis: opt.reasoning || '',
        // Source tag for Phase 4 attribution back to the session.
        source: 'deploy_cash',
        sessionId,
        optionId: opt.id,
      });
      setModal('add');
    }
    window.addEventListener('deploy_cash_pick', onPick);
    return () => window.removeEventListener('deploy_cash_pick', onPick);
  }, []);

  const positions = data?.positions ?? [];

  // (Drawdown + concentration flags now live inside the WHAT NEEDS YOU action
  // feed via buildPortfolioActions, so the old inline computations were removed.)

  if (loading) return <div style={{ padding: 16 }}><SkeletonCard /><SkeletonCard /></div>;

  return (
    <div>
      {positions.length === 0 ? (
        <EmptyState
          title="No positions yet"
          subtitle="Add your first stock to start tracking your portfolio. Just need a ticker (e.g. AAPL), number of shares, and the date you bought."
          action={<button onClick={() => setModal('add')} className="btn btn-green">Add Your First Position</button>}
          tips={[
            { title: 'What you need', body: 'Ticker symbol (AAPL, TSLA, etc.), how many shares you own, and the date you bought. Average cost is optional but helps track your P&L.' },
            { title: 'AI-powered insights', body: 'Once added, tap any position to get an AI read on whether today\'s move actually matters — calm during noise, sharp when something is genuinely broken.' },
          ]}
        />
      ) : (
        <>
          {/* Synthesis — advisor opening read on the whole book. Hides itself
              if there are no positions or the AI call failed. Refreshes when
              the position list changes (refreshKey = positions.length). */}
          <SynthesisCard refreshKey={positions.length} />

          {/* 3-stat hero — Today / Total P&L / Value get equal weight */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 2 }}>TODAY</p>
                <p style={{ fontSize: 19, fontWeight: 700, color: colorFor(data?.todayChange), letterSpacing: '-0.4px' }}>{data?.todayChange >= 0 ? '+' : ''}${fmt(Math.abs(data?.todayChange))}</p>
                <p style={{ fontSize: 10, color: colorFor(data?.todayChange) }}>
                  {data?.totalValue > 0 ? `${data.todayChange >= 0 ? '+' : ''}${fmt((data.todayChange / (data.totalValue - data.todayChange)) * 100, 2)}%` : '—'}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 2 }}>TOTAL P&L</p>
                <p style={{ fontSize: 19, fontWeight: 700, color: colorFor(data?.totalPnl), letterSpacing: '-0.4px' }}>{data?.totalPnl >= 0 ? '+' : ''}${fmt(Math.abs(data?.totalPnl))}</p>
                <p style={{ fontSize: 10, color: colorFor(data?.totalPnl) }}>
                  {data?.totalCost > 0 ? `${data.totalPnl >= 0 ? '+' : ''}${fmt((data.totalPnl / data.totalCost) * 100, 1)}%` : '—'}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 2 }}>VALUE</p>
                <p style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px' }}>${fmtCompact(data?.totalValue)}</p>
                <p style={{ fontSize: 10, color: 'var(--faint)' }}>{positions.length} position{positions.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            {data?.staleCount > 0 && (
              <p style={{ fontSize: 9, color: 'var(--amber)', marginTop: 6 }}>
                {data.staleCount} position{data.staleCount > 1 ? 's' : ''} without live pricing
              </p>
            )}
          </div>

          {/* WHAT NEEDS YOU — the prioritized action list. Supersedes the old
              drawdown/concentration bands (those are just two of the things it
              surfaces) and turns "here's a flag" into "here's the thing and the
              button to handle it." */}
          <ActionFeed positions={positions} totalValue={data?.totalValue ?? 0} />

          {/* Compact action bar — + ADD primary, refresh + menu as icons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setModal('add')} className="btn btn-green">+ ADD</button>
            <span style={{ flex: 1, fontSize: 9, color: 'var(--faint)' }}>
              {data?.lastUpdated && `Updated ${new Date(data.lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
            </span>
            <button onClick={load} className="btn btn-muted" style={{ padding: '6px 8px', fontSize: 11 }} aria-label="Refresh">↻</button>
            <button onClick={() => setModal('menu')} className="btn btn-muted" style={{ padding: '6px 8px', fontSize: 11 }} aria-label="More">⋯</button>
          </div>

          {/* Position list — the spine of the page. Sorted by attention, with calm
              positions collapsed behind a divider once there are 5+ of them. Plan-
              coverage nudge shown when many positions lack a target/stop/thesis. */}
          <PositionList
            positions={positions}
            totalValue={data?.totalValue ?? 0}
            onRefresh={load}
            showToast={showToast}
          />

          {/* What is happening on your book today — headlines across holdings.
              Ambient context, so it sits below your positions, not above them. */}
          <DevelopmentsCard />

          {/* How exposed are you — the dollar stress tests and the sector mix in
              one collapsed block (they answer the same question). */}
          <ExposureCard positions={positions} onTabSwitch={onTabSwitch} />


          {/* Inline growth chart — collapsible, only if we have snapshots */}
          <GrowthChartInline showGrowth={showGrowth} setShowGrowth={setShowGrowth} />
        </>
      )}
      {modal === 'add' && (
        <AddModal
          onClose={() => { setModal(null); setAddPrefill(null); }}
          onDone={load}
          showToast={showToast}
          prefill={addPrefill}
          onPrefillConsumed={() => setAddPrefill(null)}
          isFirstPosition={positions.length === 0}
          onAdded={(t) => setFirstRead(t)}
        />
      )}
      {firstRead && <FirstReadSheet ticker={firstRead} onClose={() => setFirstRead(null)} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={load} showToast={showToast} />}
      {modal === 'menu' && (
        <PortfolioMenuDrawer
          onClose={() => setModal(null)}
          onImport={() => setModal('import')}
          onClosedTrades={() => setModal('closed')}
          onTheses={() => setModal('theses')}
        />
      )}
      {modal === 'closed' && <ClosedTradesDrawer onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'theses' && <ThesesDrawer onClose={() => setModal(null)} showToast={showToast} />}
    </div>
  );
}

function NewsSubTab({ showToast }) {
  const [positions, setPositions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [journalSave, setJournalSave] = useState(null);

  useEffect(() => {
    api.portfolio.value().then(d => {
      setPositions(d.positions ?? []);
      if (d.positions?.length) setSelected(d.positions[0].ticker);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true); setErr(''); setArticles([]);
    api.ai.news(selected)
      .then(d => setArticles(d.articles ?? []))
      .catch(e => setErr(e.error || 'News unavailable'))
      .finally(() => setLoading(false));
  }, [selected]);

  if (!positions.length) return <EmptyState title="No positions" subtitle="Add positions to see AI-filtered news for your holdings" />;

  return (
    <div style={{ padding: '10px 16px 24px' }}>
      <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
        {positions.map(p => (
          <button key={p.ticker} onClick={() => setSelected(p.ticker)} className={`btn ${selected === p.ticker ? 'btn-blue' : 'btn-muted'}`}>{p.ticker}</button>
        ))}
      </div>
      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
      {err && <p style={{ fontSize: 12, color: 'var(--red)' }}>{err}</p>}
      {!loading && !err && articles.length === 0 && <EmptyState title="No news" subtitle="No high-impact news found for this ticker" />}
      {articles.map((a, i) => (
        <div key={i} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 13px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>{a.source?.toUpperCase()}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <p style={{ fontSize: 9, color: 'var(--faint)' }}>{a.publishedUtc ? new Date(a.publishedUtc).toLocaleDateString() : ''}</p>
              <BookmarkButton
                onClick={() => setJournalSave({
                  content: `${selected} — ${a.title}${a.aiSummary ? `\n\n${a.aiSummary}` : ''}${a.articleUrl ? `\n\n${a.articleUrl}` : ''}`,
                })}
              />
            </div>
          </div>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 5, lineHeight: 1.5 }}>{a.title}</p>
          {a.aiSummary && <p style={{ fontSize: 11, color: 'var(--blue)', lineHeight: 1.6, marginBottom: 6 }}>{renderPlainText(a.aiSummary)}</p>}
          <a href={a.articleUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--blue)', textDecoration: 'none', letterSpacing: '0.5px' }}>READ MORE →</a>
        </div>
      ))}

      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        showToast={showToast}
      />
    </div>
  );
}

function HistorySubTab({ showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.portfolio.closedTrades()
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>;
  if (!data?.trades?.length) return (
    <EmptyState title="No closed trades" subtitle="When you close a position, it'll appear here with your P&L"
      tips={[{ title: 'Build your track record', body: 'Every trade you close is recorded with entry price, exit price, P&L, hold time, and your original thesis. The Journal Coach uses this data to spot patterns in your trading.' }]} />
  );

  const { trades, stats } = data;

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', margin: '0 16px' }}>
        {[
          { label: 'TRADES', value: stats.totalTrades, color: 'var(--text)' },
          { label: 'WIN RATE', value: `${stats.winRate}%`, color: stats.winRate >= 50 ? 'var(--green)' : 'var(--red)' },
          { label: 'TOTAL P&L', value: `${stats.totalPnl >= 0 ? '+' : ''}$${fmt(stats.totalPnl)}`, color: colorFor(stats.totalPnl) },
          { label: 'AVG HOLD', value: `${stats.avgHoldDays}d`, color: 'var(--muted)' },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: '10px 6px', textAlign: 'center', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
            <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 3 }}>{s.label}</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: s.color, letterSpacing: '-0.3px' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Performance Attribution — where the user's edge actually lives */}
      <PerformanceAttributionCard showToast={showToast} />

      {/* Plan Adherence — patterns from comparing stated plan vs actual exits */}
      <PlanAdherenceCard showToast={showToast} />

      {/* Trade cards */}
      <div style={{ padding: '12px 16px 0' }}>
      {trades.map(t => {
        const isWin = t.pnl > 0;
        return (
          <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${isWin ? 'var(--green)' : 'var(--red)'}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TickerIcon ticker={t.ticker} size={28} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{t.ticker}</p>
                  <p style={{ fontSize: 9, color: 'var(--faint)' }}>{t.shares} shares · held {t.hold_days}d</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: colorFor(t.pnl) }}>{t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}</p>
                <p style={{ fontSize: 10, color: colorFor(t.pnl_percent) }}>{t.pnl_percent >= 0 ? '+' : ''}{fmt(t.pnl_percent)}%</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--faint)', marginBottom: t.entry_thesis ? 5 : 0 }}>
              <span>In: ${fmt(t.avg_cost)}</span>
              <span>Out: ${fmt(t.sell_price)}</span>
              <span>{new Date(t.closed_at).toLocaleDateString()}</span>
            </div>
            {t.entry_thesis && <p style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic', marginTop: 3 }}>"{t.entry_thesis}"</p>}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/**
 * Inline growth chart — collapsed by default. Only renders the toggle if the
 * user has 7+ portfolio snapshots, since a chart of 2 dots doesn't say much.
 * Replaces the standalone P&L sub-tab in the retail-focus redesign.
 */
function GrowthChartInline({ showGrowth, setShowGrowth }) {
  const [snapshots, setSnapshots] = useState([]);
  const [spyBenchmark, setSpyBenchmark] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.portfolio.snapshots()
      .then(d => {
        setSnapshots(d.snapshots ?? []);
        setSpyBenchmark(d.spyBenchmark ?? []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  // Hide entirely until there's enough history for the chart to be meaningful.
  if (snapshots.length < 7) return null;

  const chartData = snapshots.map((s, i) => {
    const spy = spyBenchmark[i];
    return {
      date: s.date,
      value: parseFloat(s.total_value ?? 0),
      spy: spy ? parseFloat(spy.value ?? 0) : null,
    };
  });
  // Are you beating the market? Period return for your book vs the S&P benchmark
  // (already fetched, just never drawn before).
  const hasSpy = chartData.some(d => d.spy != null);
  const first = chartData[0], last = chartData[chartData.length - 1];
  const youPct = first?.value > 0 ? ((last.value - first.value) / first.value) * 100 : null;
  const spyA = chartData.find(d => d.spy != null)?.spy;
  const spyB = [...chartData].reverse().find(d => d.spy != null)?.spy;
  const spyPct = (spyA > 0 && spyB != null) ? ((spyB - spyA) / spyA) * 100 : null;

  return (
    <div style={{ padding: '4px 16px 16px', borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setShowGrowth(g => !g)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 0', background: 'none', border: 'none',
          color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 11, letterSpacing: '0.5px',
        }}
      >
        <span>{showGrowth ? '▲' : '▼'} GROWTH ({snapshots.length} days)</span>
        <span style={{ fontSize: 9, color: 'var(--faint)' }}>tap to {showGrowth ? 'hide' : 'show'}</span>
      </button>
      {showGrowth && (
        <>
          {youPct != null && (
            <div style={{ display: 'flex', gap: 16, margin: '2px 0 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', marginRight: 5 }} />
                You <b style={{ color: youPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{youPct >= 0 ? '+' : ''}{youPct.toFixed(1)}%</b>
              </span>
              {hasSpy && spyPct != null && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--faint)', marginRight: 5, verticalAlign: 'middle' }} />
                  S&P 500 <b style={{ color: 'var(--text)' }}>{spyPct >= 0 ? '+' : ''}{spyPct.toFixed(1)}%</b>
                </span>
              )}
            </div>
          )}
          <div style={{ marginTop: 4, padding: '8px 0', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--faint)' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: 'var(--faint)' }} tickFormatter={fmtCompact} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }}
                  labelStyle={{ color: 'var(--muted)' }}
                  formatter={(v) => '$' + fmt(v)}
                />
                {hasSpy && <Line type="monotone" dataKey="spy" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="S&P 500" />}
                <Line type="monotone" dataKey="value" stroke="var(--blue)" strokeWidth={2} dot={false} name="You" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Action-menu drawer (the ⋯ button). Houses things that don't deserve a
 * top-level button in the redesign — closed trades, CSV import, etc.
 */
function PortfolioMenuDrawer({ onClose, onImport, onClosedTrades, onTheses }) {
  return (
    <Modal title="Portfolio actions" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => { onClose(); onTheses(); }}
          className="btn btn-muted"
          style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12 }}
        >
          My theses
          <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, fontWeight: 400 }}>The record of your own thinking — every position, why you bought, how it played out.</p>
        </button>
        <button
          onClick={() => { onClose(); onClosedTrades(); }}
          className="btn btn-muted"
          style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12 }}
        >
          View closed trades
          <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, fontWeight: 400 }}>Past positions you've sold, with P&L and your reflections.</p>
        </button>
        <button
          onClick={() => { onClose(); onImport(); }}
          className="btn btn-muted"
          style={{ padding: '12px 14px', textAlign: 'left', fontSize: 12 }}
        >
          Import from CSV
          <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, fontWeight: 400 }}>Bulk-add from Webull, Robinhood, or any positions export.</p>
        </button>
      </div>
    </Modal>
  );
}

/**
 * ThesesDrawer — Phase 2 "My Theses" view.
 * Two sections:
 *   ACTIVE THESES — every current position with entry + reversal, sortable
 *   PAST THESES   — every closed position with thesis + reflection + outcome
 *
 * Restrained list view, terminal aesthetic, no charts. The content is the
 * product: the user's record of their own thinking over time.
 */
function ThesesDrawer({ onClose }) {
  const [active, setActive] = useState([]);
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortActive, setSortActive] = useState('written'); // 'written' | 'size'
  const [sortPast, setSortPast] = useState('closed'); // 'closed' | 'pnl'

  useEffect(() => {
    Promise.all([
      api.portfolio.value().catch(() => ({ positions: [] })),
      api.portfolio.closedTrades().catch(() => ({ trades: [] })),
    ]).then(([pv, ct]) => {
      setActive(pv?.positions ?? []);
      setPast(ct?.trades ?? []);
      setLoading(false);
    });
  }, []);

  const sortedActive = [...active].sort((a, b) => {
    if (sortActive === 'size') return (b.currentValue ?? 0) - (a.currentValue ?? 0);
    // 'written' — newest first; positions with no timestamp sink to the bottom
    const ta = a.thesis_written_at ? new Date(a.thesis_written_at).getTime() : 0;
    const tb = b.thesis_written_at ? new Date(b.thesis_written_at).getTime() : 0;
    return tb - ta;
  });

  const sortedPast = [...past].sort((a, b) => {
    if (sortPast === 'pnl') return (b.pnl ?? 0) - (a.pnl ?? 0);
    return new Date(b.closed_at ?? 0) - new Date(a.closed_at ?? 0);
  });

  const activeWithThesis = sortedActive.filter(p => p.entry_thesis || p.reversal_condition);
  const activeWithoutThesis = sortedActive.filter(p => !p.entry_thesis && !p.reversal_condition);

  return (
    <Modal title="My theses" onClose={onClose}>
      <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : (
          <>
            {/* ── ACTIVE ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '1px' }}>
                ACTIVE THESES <span style={{ color: 'var(--muted)', fontWeight: 500, marginLeft: 4 }}>· {activeWithThesis.length}</span>
              </p>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'written', label: 'NEWEST' },
                  { id: 'size', label: 'BIGGEST' },
                ].map(o => (
                  <button
                    key={o.id}
                    onClick={() => setSortActive(o.id)}
                    style={{
                      fontSize: 9, padding: '3px 7px', borderRadius: 3,
                      background: sortActive === o.id ? 'var(--blue)' : 'transparent',
                      color: sortActive === o.id ? '#fff' : 'var(--faint)',
                      border: `1px solid ${sortActive === o.id ? 'var(--blue)' : 'var(--border)'}`,
                      cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.5px',
                    }}
                  >{o.label}</button>
                ))}
              </div>
            </div>

            {activeWithThesis.length === 0 && activeWithoutThesis.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--muted)', padding: '14px 0', textAlign: 'center' }}>
                No positions yet. Add one to start your thesis record.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {activeWithThesis.map(p => (
                <ThesisRow key={p.id} kind="active" item={p} />
              ))}
              {activeWithoutThesis.length > 0 && (
                <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px dashed rgba(245,158,11,0.25)', borderRadius: 5, padding: '8px 11px' }}>
                  <p style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 3 }}>
                    NO THESIS YET · {activeWithoutThesis.length}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                    {activeWithoutThesis.map(p => p.ticker).join(', ')} — open the position card on the Portfolio tab to add one.
                  </p>
                </div>
              )}
            </div>

            {/* ── PAST ───────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '1px' }}>
                PAST THESES <span style={{ color: 'var(--muted)', fontWeight: 500, marginLeft: 4 }}>· {past.length}</span>
              </p>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'closed', label: 'RECENT' },
                  { id: 'pnl', label: 'BY P&L' },
                ].map(o => (
                  <button
                    key={o.id}
                    onClick={() => setSortPast(o.id)}
                    style={{
                      fontSize: 9, padding: '3px 7px', borderRadius: 3,
                      background: sortPast === o.id ? 'var(--blue)' : 'transparent',
                      color: sortPast === o.id ? '#fff' : 'var(--faint)',
                      border: `1px solid ${sortPast === o.id ? 'var(--blue)' : 'var(--border)'}`,
                      cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.5px',
                    }}
                  >{o.label}</button>
                ))}
              </div>
            </div>

            {sortedPast.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--muted)', padding: '14px 0', textAlign: 'center' }}>
                No closed positions yet. They'll show up here with thesis + reflection + outcome.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedPast.map(t => (
                  <ThesisRow key={t.id} kind="past" item={t} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * ThesisRow — one item in the My Theses list. Different fields show for
 * active vs past, but the visual rhythm is the same.
 */
function ThesisRow({ kind, item }) {
  const isPast = kind === 'past';

  // Outcome chip for past trades — Win / Loss / Even by P&L.
  let outcomeChip = null;
  if (isPast) {
    const pnl = item.pnl ?? 0;
    if (pnl > 0) outcomeChip = { label: 'W', color: 'var(--green)' };
    else if (pnl < 0) outcomeChip = { label: 'L', color: 'var(--red)' };
    else outcomeChip = { label: '—', color: 'var(--faint)' };
  }

  // "Played out" mapping — translates the stored enum into a readable label.
  const playedOutLabel = {
    yes: { text: 'Thesis played out', color: 'var(--green)' },
    partially: { text: 'Thesis partially played out', color: 'var(--amber)' },
    no: { text: 'Thesis did not play out', color: 'var(--red)' },
  }[item.thesis_played_out];

  // Date strings
  let dateLabel = null;
  if (isPast && item.closed_at) {
    const d = new Date(item.closed_at);
    dateLabel = `closed ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (!isPast && item.thesis_written_at) {
    const d = new Date(item.thesis_written_at);
    dateLabel = `written ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  return (
    <div style={{
      background: 'var(--raised)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{item.ticker}</span>
          {outcomeChip && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: outcomeChip.color === 'var(--green)' ? 'rgba(34,197,94,0.15)'
                : outcomeChip.color === 'var(--red)' ? 'rgba(239,68,68,0.15)'
                : 'rgba(255,255,255,0.05)',
              color: outcomeChip.color, letterSpacing: '0.4px',
              border: `1px solid ${outcomeChip.color === 'var(--green)' ? 'rgba(34,197,94,0.3)'
                : outcomeChip.color === 'var(--red)' ? 'rgba(239,68,68,0.3)'
                : 'var(--border)'}`,
            }}>{outcomeChip.label}</span>
          )}
        </div>
        {isPast && (
          <span style={{ fontSize: 11, fontWeight: 700, color: colorFor(item.pnl ?? 0) }}>
            {(item.pnl ?? 0) >= 0 ? '+' : ''}${fmt(item.pnl ?? 0)}
            <span style={{ color: 'var(--faint)', fontWeight: 400, marginLeft: 4, fontSize: 10 }}>
              ({(item.pnl_percent ?? 0) >= 0 ? '+' : ''}{fmt(item.pnl_percent ?? 0, 1)}%)
            </span>
          </span>
        )}
        {!isPast && (
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>
            {item.shares} sh · {item.currentValue ? `$${fmt(item.currentValue)}` : '—'}
          </span>
        )}
      </div>

      {dateLabel && (
        <p style={{ fontSize: 9, color: 'var(--faint)', marginBottom: 6, letterSpacing: '0.3px' }}>
          {dateLabel}{isPast && item.hold_days != null && ` · held ${item.hold_days}d`}
        </p>
      )}

      {playedOutLabel && (
        <p style={{ fontSize: 10, color: playedOutLabel.color, fontWeight: 600, marginBottom: 5, letterSpacing: '0.2px' }}>
          {playedOutLabel.text}
        </p>
      )}

      {item.entry_thesis && (
        <div style={{ marginBottom: 5 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>WHY</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>{item.entry_thesis}</p>
        </div>
      )}

      {!isPast && item.reversal_condition && (
        <div style={{ marginBottom: 2 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>WHAT WOULD CHANGE YOUR MIND</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>{item.reversal_condition}</p>
        </div>
      )}

      {isPast && item.reflection_what_happened && (
        <div style={{ marginTop: 5 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>WHAT HAPPENED</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>{item.reflection_what_happened}</p>
        </div>
      )}
      {isPast && !item.reflection_what_happened && item.exit_reflection && (
        // Backward-compat — older closed trades only have the legacy single-field exit_reflection
        <div style={{ marginTop: 5 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>REFLECTION</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5, fontStyle: 'italic' }}>{item.exit_reflection}</p>
        </div>
      )}

      {isPast && item.reflection_lesson && (
        <div style={{ marginTop: 5 }}>
          <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 2 }}>LESSON</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>{item.reflection_lesson}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Closed-trades drawer — used to live in the History sub-tab. Now reachable
 * via the ⋯ menu. Renders the same data without the wrapper sub-tab chrome.
 */
function ClosedTradesDrawer({ onClose, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.portfolio.closedTrades()
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Modal title="Closed trades" onClose={onClose}>
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : !data?.trades?.length ? (
          <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>
            No closed trades yet. When you close a position, it appears here with P&L and any reflection you wrote.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.trades.map(t => (
              <div key={t.id} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <p style={{ fontSize: 12, fontWeight: 700 }}>{t.ticker}</p>
                  <p style={{ fontSize: 11, fontWeight: 700, color: colorFor(t.pnl) }}>{t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)} ({t.pnl_percent >= 0 ? '+' : ''}{fmt(t.pnl_percent, 1)}%)</p>
                </div>
                <p style={{ fontSize: 10, color: 'var(--faint)' }}>
                  {t.shares} sh · in ${fmt(t.avg_cost)} → out ${fmt(t.sell_price)} · held {t.hold_days}d
                </p>
                {t.entry_thesis && <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>"{t.entry_thesis}"</p>}
                {t.exit_reflection && <p style={{ fontSize: 10, color: 'var(--blue)', marginTop: 4 }}>{t.exit_reflection}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PnLSubTab() {
  const [snapshots, setSnapshots] = useState([]);
  const [spyBenchmark, setSpyBenchmark] = useState([]);
  const [showSpy, setShowSpy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [snapping, setSnapping] = useState(false);
  const [snapMsg, setSnapMsg] = useState('');

  useEffect(() => { api.portfolio.snapshots().then(d => { setSnapshots(d.snapshots ?? []); setSpyBenchmark(d.spyBenchmark ?? []); setLoading(false); }).catch(() => setLoading(false)); }, []);

  async function takeSnapshot() {
    setSnapping(true); setSnapMsg('');
    try {
      const d = await api.portfolio.takeSnapshot();
      if (d.alreadyExists) { setSnapMsg('Already snapshotted today'); }
      else { setSnapMsg(`Snapshot saved — $${(d.totalValue ?? 0).toLocaleString()}`); }
      const fresh = await api.portfolio.snapshots();
      setSnapshots(fresh.snapshots ?? []);
    } catch (e) { setSnapMsg(e.error || 'Snapshot failed'); }
    setSnapping(false);
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>;
  if (!snapshots.length) return (
    <div>
      <EmptyState title="Track Your Growth" subtitle="See how your portfolio value changes over time with a daily P&L chart"
        action={<button onClick={takeSnapshot} disabled={snapping} className="btn btn-blue">{snapping ? 'Saving...' : 'Take First Snapshot'}</button>}
        tips={[
          { title: 'What is this?', body: 'This chart tracks your total portfolio value day by day. Going up means you are making money. Going down means you are losing. Simple as that.' },
          { title: 'How it works', body: 'We save your portfolio value once a day at 4:30 PM ET. You can also tap the button above anytime. After a few days you will see your performance plotted as a line chart.' },
        ]} />
      {snapMsg && <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--green)', padding: '8px 16px' }}>{snapMsg}</p>}
    </div>
  );

  // Calculate P&L from first snapshot to latest
  const firstVal = snapshots[0]?.total_value ?? 0;
  const latestVal = snapshots[snapshots.length - 1]?.total_value ?? 0;
  const totalChange = latestVal - firstVal;
  const totalChangePct = firstVal > 0 ? ((totalChange / firstVal) * 100) : 0;
  const isUp = totalChange >= 0;
  const lineColor = isUp ? 'var(--green)' : 'var(--red)';

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Big number hero — Robinhood style */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 4 }}>PORTFOLIO VALUE</p>
        <p style={{ fontSize: 30, fontWeight: 700, color: 'var(--text)', letterSpacing: '-1px', marginBottom: 4 }}>
          ${latestVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <p style={{ fontSize: 13, fontWeight: 600, color: lineColor }}>
          {isUp ? '+' : ''}${totalChange.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({isUp ? '+' : ''}{totalChangePct.toFixed(2)}%)
          <span style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400, marginLeft: 6 }}>all time</span>
        </p>
      </div>

      {/* Chart — line color matches gain/loss like Robinhood */}
      {(() => {
        // Merge SPY benchmark into snapshot data
        const spyMap = {};
        spyBenchmark.forEach(s => { spyMap[s.date] = s.spy_value; });
        const chartData = snapshots.map(s => ({ ...s, spy_value: spyMap[s.date] ?? null }));
        const hasSpy = spyBenchmark.length > 0;

        // Calculate SPY performance for comparison
        let spyChange = null, spyChangePct = null;
        if (hasSpy && spyBenchmark.length >= 2) {
          const spyFirst = spyBenchmark[0].spy_value;
          const spyLast = spyBenchmark[spyBenchmark.length - 1].spy_value;
          spyChange = spyLast - spyFirst;
          spyChangePct = spyFirst > 0 ? ((spyChange / spyFirst) * 100) : 0;
        }

        return (
          <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 14px 10px' }}>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--faint)' }} tickLine={false} axisLine={false} tickFormatter={d => { const parts = d.split('-'); return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`; }} />
                  <YAxis hide domain={['dataMin - 100', 'dataMax + 100']} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, fontFamily: 'inherit', padding: '8px 12px' }} formatter={(v, name) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name === 'spy_value' ? 'SPY' : 'Portfolio']} labelFormatter={d => { const parts = d.split('-'); return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}/${parts[0]}`; }} />
                  <Line type="monotone" dataKey="total_value" stroke={lineColor} dot={chartData.length < 3 ? { r: 4, fill: lineColor } : false} strokeWidth={2.5} name="Portfolio" />
                  {hasSpy && showSpy && <Line type="monotone" dataKey="spy_value" stroke="var(--faint)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" name="SPY" />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 9, color: 'var(--faint)' }}>{snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}</p>
                {hasSpy && (
                  <button onClick={() => setShowSpy(s => !s)} style={{ fontSize: 8, color: showSpy ? 'var(--blue)' : 'var(--faint)', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {showSpy ? 'SPY ON' : 'SPY OFF'}
                  </button>
                )}
                {hasSpy && showSpy && spyChangePct != null && (
                  <span style={{ fontSize: 8, color: 'var(--faint)' }}>
                    SPY: <span style={{ color: spyChangePct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(1)}%</span>
                    {' '}vs You: <span style={{ color: totalChangePct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{totalChangePct >= 0 ? '+' : ''}{totalChangePct.toFixed(1)}%</span>
                  </span>
                )}
              </div>
              <button onClick={takeSnapshot} disabled={snapping} style={{ fontSize: 9, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.3px' }}>
                {snapping ? 'SAVING...' : '+ SNAPSHOT'}
              </button>
            </div>
            {snapMsg && <p style={{ fontSize: 10, color: 'var(--green)', marginTop: 6, textAlign: 'center' }}>{snapMsg}</p>}
          </div>
        );
      })()}
    </div>
  );
}

export default function PortfolioTab({ marketOpen, showToast, onTabSwitch }) {
  // Single scrollable view — sub-tabs removed in the retail-focus redesign.
  // Closed trades live behind the action menu (⋯ → "View closed trades").
  // The growth chart inlines on this same view once 7+ snapshots exist.
  // History/News/P&L sub-component code stays in this file for now (might
  // be revived as drawers); they're just no longer rendered by default.

  // Research overlay: any position can open the full company dossier (the same
  // research view as Social) by dispatching 'research_open'. This tab is mounted
  // only when active, so the listener never collides with Social's.
  const [researchTicker, setResearchTicker] = useState(null);
  const [researchContext, setResearchContext] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.ticker;
      if (t) { setResearchTicker(String(t).toUpperCase()); setResearchContext(e.detail?.context || null); }
    };
    window.addEventListener('research_open', handler);
    return () => window.removeEventListener('research_open', handler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="scrollable" style={{ flex: 1 }}>
        {researchTicker ? (
          <StockDossier ticker={researchTicker} context={researchContext}
            onClose={() => { setResearchTicker(null); setResearchContext(null); }} showToast={showToast} />
        ) : (
          <PortfolioSubTab marketOpen={marketOpen} showToast={showToast} onTabSwitch={onTabSwitch} />
        )}
      </div>
    </div>
  );
}
