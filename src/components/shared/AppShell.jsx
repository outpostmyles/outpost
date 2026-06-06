import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { getMarketStatus } from '../../utils/market.js';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import HomeTab from '../home/HomeTab.jsx';
import PortfolioTab from '../portfolio/PortfolioTab.jsx';
import SocialTab from '../social/SocialTab.jsx';
import AgentTab from '../agent/AgentTab.jsx';
import JournalTab from '../journal/JournalTab.jsx';
import SettingsPage from '../settings/SettingsPage.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import FounderDashboard from '../admin/FounderDashboard.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const TABS = [
  { id: 'home', label: 'HOME', icon: HomeIcon },
  { id: 'portfolio', label: 'PORT', icon: PortIcon },
  { id: 'social', label: 'SOCIAL', icon: SocialIcon },
  { id: 'agent', label: 'AGENT', icon: AgentIcon },
  { id: 'journal', label: 'PROGRESS', icon: ProgressIcon },
];

function Logo() {
  return (
    <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(180deg, #4d8dff, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 10px rgba(59,130,246,0.4)' }}>
      <svg width="15" height="15" viewBox="0 0 72 72" fill="none">
        <rect x="18" y="18" width="36" height="22" rx="2" fill="#fff"/>
        <rect x="22" y="23" width="8" height="5" rx="1" fill="#3b82f6"/>
        <rect x="42" y="23" width="8" height="5" rx="1" fill="#3b82f6"/>
        <rect x="15" y="40" width="42" height="2.5" rx="1" fill="#fff" opacity="0.6"/>
        <line x1="22" y1="42" x2="15" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
        <line x1="30" y1="42" x2="27" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
        <line x1="42" y1="42" x2="45" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
        <line x1="50" y1="42" x2="57" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// Live book tape: the user's holdings scrolling with today's move, terminal style.
// Two copies in a row so the marquee loops seamlessly. Edges feathered with a mask.
function BookTape({ items }) {
  const Row = () => (
    <>
      {items.map((it, i) => (
        <span key={it.ticker + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 13px' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.5px' }}>{it.ticker}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: it.pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{it.pct >= 0 ? '+' : ''}{it.pct.toFixed(1)}%</span>
        </span>
      ))}
    </>
  );
  return (
    <div style={{ overflow: 'hidden', borderBottom: '1px solid var(--border)', background: 'rgba(122,162,255,0.015)', padding: '5px 0', whiteSpace: 'nowrap', flexShrink: 0, position: 'relative', zIndex: 5, maskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)' }}>
      <div style={{ display: 'inline-block', animation: 'asTape 42s linear infinite' }}>
        <Row /><Row />
      </div>
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());
  const [time, setTime] = useState(new Date());
  const [sentiment, setSentiment] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'info' });
  // Tracks whether any position has hit its target or broken its stop. Drives a
  // red dot on the Portfolio tab so the user notices urgency from any screen.
  const [hasUrgentAlert, setHasUrgentAlert] = useState(false);
  // Blue dot on the Agent tab when Outpost has posted a proactive opener the user
  // hasn't seen yet. This is what makes the agent reach out and actually pull
  // them in, rather than waiting to be opened.
  const [agentWaiting, setAgentWaiting] = useState(false);
  // A live ticker tape of the user's own book (ticker + today's move), scrolling
  // in the header strip like a trading terminal. Populated from the same
  // portfolio poll that drives urgent alerts, so it costs no extra fetch.
  const [bookTape, setBookTape] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => { setMarketStatus(getMarketStatus()); setTime(new Date()); }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.market.sentiment().then(d => setSentiment(d)).catch(() => {});
  }, []);

  // Poll portfolio for urgent alerts (TARGET HIT / STOP BROKEN). Cheap — uses
  // the same /portfolio/value endpoint Home already loads, so it hits cache.
  // Refreshes every 60s during market hours so a mid-day move is noticed.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const check = async () => {
      try {
        // Share the cache key with HomeTab — when Home is loaded the data is
        // already in memory, so this hits memory not the server.
        const data = await cachedFetch('home_portfolio', () => api.portfolio.value(), 30000);
        if (cancelled) return;
        const positions = data?.positions ?? [];
        const urgent = positions.some(p => {
          if (!p.currentPrice) return false;
          if (p.stop_loss && p.currentPrice < p.stop_loss) return true;
          if (p.price_target && p.currentPrice >= p.price_target) return true;
          return false;
        });
        setHasUrgentAlert(urgent);
        setBookTape(positions
          .filter(p => p.ticker && Number.isFinite(p.todayChangePercent))
          .map(p => ({ ticker: p.ticker, pct: p.todayChangePercent })));
      } catch {}
    };

    check();
    // Only poll while the page is foregrounded — saves battery on mobile.
    const intervalMs = marketStatus.isOpen ? 60000 : 5 * 60000;
    timer = setInterval(check, intervalMs);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [marketStatus.isOpen]);

  function showToast(msg, type = 'info') {
    setToast({ show: true, msg, type });
    // Errors stay visible longer so users can read them
    const duration = type === 'error' ? 5000 : type === 'success' ? 2500 : 3000;
    setTimeout(() => setToast({ show: false, msg: '', type: 'info' }), duration);
  }

  // Listen for session expiry and show a toast
  useEffect(() => {
    const handleExpired = () => {
      showToast('Session expired — please sign in again', 'error');
    };
    window.addEventListener('auth_expired', handleExpired);
    return () => window.removeEventListener('auth_expired', handleExpired);
  }, []);

  // When the user opens the agent, clear the unread dot and mark today's opener
  // seen so it doesn't nag again on the next load.
  useEffect(() => {
    if (activeTab === 'agent') {
      setAgentWaiting(false);
      api.agent.openerSeen().catch(() => {});
    }
  }, [activeTab]);

  // Tap-to-ask, universal: any surface can drop the user into the agent just by
  // dispatching 'agent_prefill' (AgentTab's own listener fills the input). We
  // navigate to the agent here, so a card anywhere becomes a one-tap way into
  // the conversation without threading a callback through every component.
  useEffect(() => {
    const toAgent = () => setActiveTab('agent');
    window.addEventListener('agent_prefill', toAgent);
    return () => window.removeEventListener('agent_prefill', toAgent);
  }, []);

  function switchTab(id) { setActiveTab(id); }

  const etTime = time.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });

  const vix = sentiment?.vix?.value;
  const fg = sentiment?.fearGreed?.value;
  const spyRsi = sentiment?.rsi?.SPY?.value;
  const qqqRsi = sentiment?.rsi?.QQQ?.value;
  const regime = sentiment?.marketRegime ?? 'NEUTRAL';

  const regimeBg = regime === 'Risk Off' ? 'rgba(239,68,68,0.05)' : regime === 'Risk On' ? 'rgba(34,197,94,0.05)' : 'rgba(245,158,11,0.05)';
  const regimeBorder = regime === 'Risk Off' ? 'rgba(239,68,68,0.1)' : regime === 'Risk On' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)';
  const regimeColor = regime === 'Risk Off' ? 'var(--red)' : regime === 'Risk On' ? 'var(--green)' : 'var(--amber)';

  function vixColor(v) { if (!v) return 'var(--faint)'; if (v >= 30) return 'var(--red)'; if (v >= 20) return 'var(--amber)'; return 'var(--green)'; }
  function fgColor(v) { if (!v) return 'var(--faint)'; if (v < 30) return 'var(--red)'; if (v > 70) return 'var(--green)'; return 'var(--amber)'; }

  const totalCredits = (user?.credits_remaining ?? 0) + (user?.credits_used_this_month ?? 0) || 1;
  const usagePct = user ? Math.min(100, Math.round(((user.credits_used_this_month ?? 0) / totalCredits) * 100)) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'radial-gradient(1100px 460px at 50% -240px, rgba(59,130,246,0.08), transparent 72%), var(--bg)' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        @keyframes asTape { from{transform:translateX(0)} to{transform:translateX(-50%)} }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(16,19,29,0.86), rgba(8,10,17,0.9))', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 1px 0 rgba(122,162,255,0.06), 0 6px 24px rgba(0,0,0,0.32)', flexShrink: 0, position: 'relative', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)' }}>OUTPOST</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 3, background: `${marketStatus.color}12`, border: `1px solid ${marketStatus.color}28` }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: marketStatus.color, animation: marketStatus.isOpen ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: marketStatus.color, letterSpacing: '0.8px' }}>{marketStatus.label}</span>
          </div>
          <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>{etTime} ET</span>
          <button onClick={() => switchTab('settings')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: activeTab === 'settings' ? 'var(--blue)' : 'var(--faint)', transition: 'color 0.15s' }}>
            <SettingsIcon active={activeTab === 'settings'} />
          </button>
        </div>
      </div>

      {/* Regime bar — only on non-settings/admin tabs */}
      {activeTab !== 'settings' && activeTab !== 'admin' && (
        <div style={{ background: regimeBg, borderBottom: `1px solid ${regimeBorder}`, padding: '4px 16px', display: 'flex', gap: 18, overflow: 'hidden', flexShrink: 0 }}>
          {[
            { label: 'REGIME', value: regime?.toUpperCase().replace('RISK ', 'R-') ?? 'NEUTRAL', color: regimeColor },
            { label: 'VIX', value: vix != null ? vix.toFixed(1) : '—', color: vixColor(vix) },
            { label: 'F&G', value: fg != null ? fg : '—', color: fgColor(fg) },
            { label: 'SPY RSI', value: spyRsi != null ? spyRsi.toFixed(1) : '—', color: 'var(--faint)' },
            { label: 'QQQ RSI', value: qqqRsi != null ? qqqRsi.toFixed(1) : '—', color: 'var(--faint)' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
              {item.label} <b style={{ color: item.color, fontWeight: 700 }}>{item.value}</b>
            </div>
          ))}
        </div>
      )}

      {/* Live book tape: the user's own positions scrolling like a terminal. */}
      {activeTab !== 'settings' && activeTab !== 'admin' && bookTape.length > 0 && (
        <BookTape items={bookTape} />
      )}

      {/* Toast */}
      {toast.show && (
        <div style={{ margin: '6px 16px 0', padding: '8px 12px', background: 'var(--raised)', border: `1px solid ${toast.type === 'error' ? 'rgba(239,68,68,0.3)' : toast.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`, borderRadius: 5, fontSize: 11, color: toast.type === 'error' ? '#fca5a5' : toast.type === 'success' ? '#86efac' : '#93c5fd', flexShrink: 0 }}>
          {toast.msg}
        </div>
      )}

      {/* PWA install prompt — auto-hides when standalone or recently dismissed */}
      <InstallPrompt />

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Agent stays mounted so in-flight responses aren't lost, so it gets its
            own boundary: a crash here can't take down the rest of the app. */}
        <ErrorBoundary variant="inline">
          <div style={{ display: activeTab === 'agent' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <AgentTab user={user} showToast={showToast} onOpenerWaiting={setAgentWaiting} active={activeTab === 'agent'} />
          </div>
        </ErrorBoundary>
        {/* The other tabs share one boundary, keyed by tab so switching away and
            back remounts it and clears a crashed view. One bad card degrades its
            own tab, not the whole shell, the nav stays alive. */}
        <ErrorBoundary variant="inline" key={activeTab}>
          {activeTab === 'home' && <HomeTab marketStatus={marketStatus} sentiment={sentiment} onSentimentLoad={setSentiment} onTabSwitch={switchTab} showToast={showToast} />}
          {activeTab === 'portfolio' && <PortfolioTab marketOpen={marketStatus.isOpen} showToast={showToast} onTabSwitch={switchTab} />}
          {activeTab === 'social' && <SocialTab showToast={showToast} />}
          {activeTab === 'journal' && <JournalTab showToast={showToast} onTabSwitch={switchTab} />}
          {activeTab === 'settings' && <SettingsPage user={user} onLogout={logout} showToast={showToast} onOpenAdmin={() => switchTab('admin')} />}
          {activeTab === 'admin' && <FounderDashboard onBack={() => switchTab('settings')} />}
        </ErrorBoundary>
      </div>

      {/* Bottom nav */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(13,16,24,0.86), rgba(6,8,13,0.92))', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 -1px 0 rgba(122,162,255,0.06), 0 -6px 24px rgba(0,0,0,0.34)', paddingBottom: 'env(safe-area-inset-bottom)', position: 'relative', zIndex: 5 }}>
        <div style={{ display: 'flex', padding: '8px 0 12px' }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            // Show a red dot on the Portfolio tab when at least one position
            // is past its target or stop. Pulses to draw the eye without being
            // obnoxious. Hides itself on the active tab — the user is already
            // there. On any other tab it's a quiet "you should look" cue.
            // Portfolio shows a red urgency dot; the agent shows a blue "Outpost
            // has something for you" dot when an unseen opener is waiting.
            const dotColor = (id === 'portfolio' && hasUrgentAlert && !active) ? 'var(--red)'
              : (id === 'agent' && agentWaiting && !active) ? 'var(--blue)'
              : null;
            return (
              <button key={id} onClick={() => switchTab(id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', color: active ? 'var(--blue)' : 'var(--faint)', transition: 'color 0.18s', position: 'relative' }}>
                {active && <span style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', width: 22, height: 2, borderRadius: 2, background: 'var(--blue)', boxShadow: '0 0 8px rgba(59,130,246,0.7)' }} />}
                <div style={{ position: 'relative', display: 'inline-block', transition: 'transform 0.18s cubic-bezier(0.16,1,0.3,1)', transform: active ? 'translateY(-1px)' : 'none' }}>
                  {active && <span style={{ position: 'absolute', inset: -7, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.4), transparent 70%)', filter: 'blur(3px)' }} />}
                  <Icon active={active} />
                  {dotColor && (
                    <span style={{
                      position: 'absolute', top: -2, right: -4,
                      width: 7, height: 7, borderRadius: '50%',
                      background: dotColor,
                      boxShadow: '0 0 0 2px var(--surface)',
                      animation: 'pulse 1.6s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.8px' }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HomeIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={active ? 'var(--blue)' : 'none'} stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function PortIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="17" x2="8" y2="10"/><line x1="12" y1="17" x2="12" y2="7"/><line x1="16" y1="17" x2="16" y2="13"/></svg>;
}
function SocialIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
}
function AgentIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={active ? 'var(--blue)' : 'none'} stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}
function ProgressIcon({ active }) {
  // Trending-up: Progress is about getting better over time, not a notebook.
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>;
}
function SettingsIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
}
