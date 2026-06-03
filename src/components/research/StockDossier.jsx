import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
// The dossier's presentational views were first built inside the screener, so we
// import them from there to render the exact same research view everywhere. A
// later cleanup can relocate DossierView / CompareView into this folder; importing
// them is the low-risk move and keeps a single source of truth (no duplication).
import { DossierView, CompareView } from '../social/ScreenersView.jsx';

/**
 * Self-contained research surface for one ticker. Fetches its own data and handles
 * status / watch / deep-dive / compare-to-holdings, so any surface (Discover,
 * watchlist, screener) can open the same dossier with one line:
 *   <StockDossier ticker={t} onClose={...} showToast={...} />
 */
export default function StockDossier({ ticker, context = null, onClose, showToast }) {
  const [dossier, setDossier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatusState] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [compareData, setCompareData] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setDossier(null); setCompareData(null); setStatusState(null);
    api.research.dossier(ticker)
      .then(d => { if (alive) { setDossier(d.dossier || null); setStatusState(d.dossier?.status ?? null); } })
      .catch(e => { if (alive) setError(e.error || 'Could not load research right now'); })
      .finally(() => { if (alive) setLoading(false); });
    api.portfolio.sectors().then(d => { if (alive) setHoldings(d.holdings || []); }).catch(() => {});
    return () => { alive = false; };
  }, [ticker]);

  async function setStatus(s) {
    const next = status === s ? null : s; // tapping the active one clears it
    try {
      await api.research.setStatus(ticker, next);
      setStatusState(next);
      setDossier(d => d ? { ...d, status: next } : d);
    } catch (e) { showToast?.(e.error || 'Could not save your call', 'error'); }
  }
  async function watch() {
    try { await api.social.addToWatchlist({ ticker, companyName: dossier?.name || ticker }); showToast?.(`${ticker} added to watchlist`, 'success'); }
    catch (e) { showToast?.(e.error || 'Could not add to watchlist', 'error'); }
  }
  function deepDive() {
    const name = dossier?.name && dossier.name !== ticker ? ` (${dossier.name})` : '';
    const h = dossier?.holding;
    const message = h
      ? `I hold ${h.shares} shares of ${ticker}${name} at $${h.avgCost}, currently ${h.pnlPct >= 0 ? 'up' : 'down'} ${Math.abs(h.pnlPct)}%.${h.thesis ? ` My thesis was: "${h.thesis}".` : ''} Is that still working given what is going on now? Walk me through whether to hold, add, or trim, and be honest about the risks.`
      : `Give me a full research read on ${ticker}${name}. What does the company actually do, the bull case, the bear case, how the valuation looks, and most importantly whether it fits my portfolio and goals given what you know about me. Be honest about the risks.`;
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message } }));
  }
  async function compareToHoldings() {
    const d = dossier; if (!d) return;
    const same = holdings.filter(h => h.sector === d.sector && h.ticker !== ticker)
      .sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 2).map(h => h.ticker);
    if (!same.length) { showToast?.(`You hold nothing else in ${d.sector}`, 'error'); return; }
    try { const r = await api.research.compare([ticker, ...same]); setCompareData(r); }
    catch (e) { showToast?.(e.error || 'Could not compare those', 'error'); }
  }
  function deepDiveCompare() {
    const ts = (compareData?.dossiers || []).map(x => x.ticker);
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message:
      `Compare ${ts.join(', ')} for my portfolio. Which fits best given my concentration and goals, and what are the tradeoffs between them? Be honest about the risks.` } }));
  }

  if (compareData) return <CompareView data={compareData} onBack={() => setCompareData(null)} onAskAll={deepDiveCompare} />;

  const sameHeld = dossier?.sector && dossier.sector !== 'Unknown'
    ? holdings.filter(h => h.sector === dossier.sector && h.ticker !== ticker).map(h => h.ticker)
    : [];
  return (
    <DossierView ticker={ticker} dossier={dossier} loading={loading} error={error}
      status={status} onStatus={setStatus} sameHeld={sameHeld} onCompareHoldings={compareToHoldings} context={context}
      onBack={onClose} onWatch={watch} onAsk={deepDive} />
  );
}
