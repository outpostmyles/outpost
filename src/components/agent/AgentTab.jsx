import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { renderPlainText } from '../../utils/renderText.js';
import { TickerIcon, Spinner, DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

// Detect the first $TICKER or plain TICKER reference in a message for auto-fill
function detectTicker(text) {
  if (!text) return '';
  const dollarMatch = text.match(/\$([A-Z]{1,5})\b/);
  if (dollarMatch) return dollarMatch[1];
  return '';
}

const FALLBACK_STARTERS = [
  'What is happening in the market today?',
  'Should I average down on any of my positions?',
  'Find me a stock worth looking at this week',
  'Break down my portfolio — where am I most exposed?',
  'Is now a good time to buy the dip?',
  'What would you do with my portfolio right now?',
];

function Message({ msg, isLast, onSaveToJournal }) {
  const isUser = msg.role === 'user';
  const showBookmark = !isUser && !msg.streaming && msg.content && msg.content.trim().length > 10;
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row', marginBottom: 12 }}>
      {!isUser && (
        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--blue)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
      )}
      <div style={{ maxWidth: '80%', background: isUser ? 'rgba(59,130,246,0.14)' : 'var(--surface)', border: `1px solid ${isUser ? 'rgba(59,130,246,0.22)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 12px' }}>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: isUser ? '#93c5fd' : 'var(--muted)', whiteSpace: 'pre-wrap' }}>
          {isUser ? msg.content : renderPlainText(msg.content)}
        </p>
        {!isUser && msg.toolWarning && (
          <p style={{ fontSize: 9, color: 'var(--amber)', marginTop: 6, letterSpacing: '0.2px' }}>{msg.toolWarning}</p>
        )}
        {showBookmark && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <BookmarkButton onClick={() => onSaveToJournal?.(msg)} />
          </div>
        )}
        {!isUser && isLast && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <DisclaimerBadge />
          </div>
        )}
      </div>
    </div>
  );
}

function OpportunityCard({ opp, onWatch, showToast }) {
  const [watching, setWatching] = useState(false);

  async function handleWatch() {
    if (watching) return;
    setWatching(true);
    try {
      await api.social.addToWatchlist({ ticker: opp.ticker, companyName: opp.ticker });
      showToast(`${opp.ticker} added to watchlist`, 'success');
    } catch (e) {
      setWatching(false); // Re-enable button on failure so user can retry
      showToast(e.error || 'Failed', 'error');
    }
  }

  return (
    <div style={{ background: 'var(--raised)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 8, padding: '12px 13px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <TickerIcon ticker={opp.ticker} size={30} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{opp.ticker}</span>
        {opp.price && <span style={{ fontSize: 11, color: 'var(--muted)' }}>${opp.price?.toFixed(2)}</span>}
        {opp.changePercent != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: opp.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {opp.changePercent >= 0 ? '+' : ''}{opp.changePercent?.toFixed(2)}%
          </span>
        )}
        {opp.marketCap && <span className="badge badge-amber">{opp.marketCap?.toUpperCase()}</span>}
        {opp.confidence && <span className="badge badge-blue">{opp.confidence}% CONF</span>}
      </div>
      {opp.thesis && <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 7 }}>{renderPlainText(opp.thesis)}</p>}
      {opp.signals?.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {opp.signals.map((s, i) => <span key={i} className="badge badge-gray">{s}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={handleWatch} disabled={watching} className={`btn ${watching ? 'btn-muted' : 'btn-blue'}`} style={{ flex: 1, opacity: watching ? 0.6 : 1 }}>
          {watching ? 'WATCHING' : 'WATCH'}
        </button>
      </div>
    </div>
  );
}

function MemoryViewer({ showToast, refreshKey }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try { const d = await api.agent.memories(); setMemories(d.memories ?? []); }
    catch {} finally { setLoading(false); }
  }

  // Load on mount, when expanded, or when refreshKey changes (after new messages)
  useEffect(() => { load(); }, [refreshKey]);
  useEffect(() => { if (open) load(); }, [open]);

  async function deleteMemory(id) {
    try {
      await api.agent.deleteMemory(id);
      setMemories(m => m.filter(mem => mem.id !== id));
      showToast('Memory removed', 'success');
    } catch { showToast('Failed to remove', 'error'); }
  }

  const typeLabel = (t) => {
    if (t === 'decision') return 'DECISION';
    if (t === 'trade_intent') return 'TRADE PLAN';
    if (t === 'preference') return 'PREFERENCE';
    if (t === 'insight') return 'INSIGHT';
    return (t || 'NOTE').toUpperCase();
  };

  const typeColor = (t) => {
    if (t === 'decision') return 'var(--green)';
    if (t === 'trade_intent') return 'var(--amber)';
    if (t === 'preference') return 'var(--blue)';
    return 'var(--faint)';
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
          <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>AGENT MEMORY</span>
          <span style={{ fontSize: 9, color: 'var(--faint)', opacity: 0.6 }}>{memories.length > 0 ? `${memories.length} items` : ''}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--faint)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 10px', maxHeight: 220, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: 12 }}>Loading memories...</p>
          ) : memories.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: 12 }}>No memories yet. The agent learns about you as you chat.</p>
          ) : (
            <>
            {memories.length > 2 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button onClick={async () => {
                  if (!window.confirm('Clear all agent memories? This cannot be undone.')) return;
                  try {
                    await api.agent.clearMemories();
                    setMemories([]);
                    showToast('All memories cleared', 'success');
                  } catch { showToast('Failed to clear', 'error'); }
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 9, opacity: 0.6, fontFamily: 'inherit' }}>Clear all</button>
              </div>
            )}
            {memories.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: typeColor(m.memory_type), letterSpacing: '0.5px' }}>{typeLabel(m.memory_type)}</span>
                    {m.ticker && <span style={{ fontSize: 8, color: 'var(--faint)' }}>{m.ticker}</span>}
                    <span style={{ fontSize: 8, color: 'var(--faint)', opacity: 0.5 }}>{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.content}</p>
                </div>
                <button onClick={() => deleteMemory(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 12, padding: '2px 4px', flexShrink: 0, opacity: 0.5 }} title="Remove this memory">×</button>
              </div>
            ))
            }</>
          )}
        </div>
      )}
    </div>
  );
}

let msgIdCounter = 0;
function nextMsgId() { return `local_${Date.now()}_${++msgIdCounter}`; }

export default function AgentTab({ user, showToast, onOpenerWaiting }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');
  const [cleared, setCleared] = useState(false);
  const [memoryKey, setMemoryKey] = useState(0);
  const [starters, setStarters] = useState(FALLBACK_STARTERS);
  const [freeTierUsage, setFreeTierUsage] = useState(null); // { used, limit }
  const [journalSave, setJournalSave] = useState(null); // { content, ticker, sourceRef } or null
  const [convId, setConvId] = useState(null);            // current conversation
  const [conversations, setConversations] = useState([]); // list for the switcher
  const [showConvList, setShowConvList] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const pendingJumpRef = useRef(false); // true → next render should JUMP to the latest message (a fresh load), not smooth-scroll

  const makeConvId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const refreshConversations = useCallback(async () => {
    try { const d = await api.agent.conversations(); setConversations(d.conversations ?? []); return d.conversations ?? []; }
    catch { return []; }
  }, []);

  const openConversation = useCallback(async (id) => {
    // Stop any reply still streaming in the conversation we're leaving so its
    // late setState calls can't land on the conversation we're opening. The
    // server persists that reply independently, so nothing is lost.
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null; }
    setSending(false);
    pendingJumpRef.current = true; // open at the most recent message, not the top
    setConvId(id);
    setShowConvList(false);
    setErr('');
    setLoading(true);
    try {
      const d = await api.agent.messages(id);
      setMessages(d.messages ?? []);
      if (d.starters?.length) setStarters(d.starters);
    } catch {}
    setLoading(false);
  }, []);

  // On mount: let the agent reach out (posts the daily opener), then load the
  // conversation list and open the most recent one (the opener's, if it just
  // posted). Brand-new users get a fresh empty chat.
  const init = useCallback(async () => {
    setLoading(true);
    try { const op = await api.agent.opener(); onOpenerWaiting?.(!!op?.waiting); } catch {}
    const convs = await refreshConversations();
    if (convs.length > 0) {
      await openConversation(convs[0].id);
    } else {
      setConvId(makeConvId());
      setMessages([]);
      setLoading(false);
    }
  }, [onOpenerWaiting, refreshConversations, openConversation]);

  useEffect(() => { init(); }, [init]);

  // Scroll-to-bottom. On a fresh conversation load we JUMP instantly to the most
  // recent message (a chat should open at the latest response, not the top); while
  // a reply streams in we follow it smoothly. The jump waits for `loading` to flip
  // false because the message list (and bottomRef) is not mounted until then. The
  // old effect fired during the spinner and silently no-op'd, leaving chats at top.
  useEffect(() => {
    if (loading) return;
    if (pendingJumpRef.current) {
      pendingJumpRef.current = false;
      const jump = () => bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      jump();
      requestAnimationFrame(jump); // again after layout settles (markdown/long lists)
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, loading]);

  // Phase 4 bridge — DeployCashFlow's "None of these feel right? → Talk it
  // out with the agent" dispatches an 'agent_prefill' window event with a
  // pre-composed message. We pre-fill the input so the user can edit and
  // send instead of retyping. Without this listener, that message is lost.
  useEffect(() => {
    function onPrefill(e) {
      const message = e?.detail?.message;
      if (typeof message === 'string' && message.trim()) {
        // ASK from anywhere starts a FRESH conversation so it never clogs the
        // thread the user was working in.
        if (streamRef.current) { streamRef.current.abort(); streamRef.current = null; }
        setConvId(makeConvId());
        setMessages([]);
        setErr('');
        setShowConvList(false);
        setInput(message);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    }
    window.addEventListener('agent_prefill', onPrefill);
    return () => window.removeEventListener('agent_prefill', onPrefill);
  }, []);

  const streamRef = useRef(null);

  // Abort stream on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.abort();
        streamRef.current = null;
      }
    };
  }, []);

  async function send(content = input.trim()) {
    if (!content || sending) return;
    // Abort any lingering previous stream before starting a new one
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null; }
    setSending(true);
    setInput('');
    setErr('');
    const userMsgId = nextMsgId();
    const assistantMsgId = nextMsgId();
    const userMsg = { id: userMsgId, role: 'user', content, created_at: new Date().toISOString() };
    // Add user message + empty assistant placeholder for streaming
    setMessages(m => [...m, userMsg, { id: assistantMsgId, role: 'assistant', content: '', created_at: new Date().toISOString(), streaming: true }]);

    let fullText = '';
    let hadError = false;

    streamRef.current = api.agent.stream(content, convId, {
      onText: (chunk) => {
        fullText += chunk;
        setMessages(m => m.map(msg =>
          msg.id === assistantMsgId ? { ...msg, content: fullText } : msg
        ));
      },
      onStatus: (data) => {
        // Show tool activity in the streaming message
        setMessages(m => m.map(msg =>
          msg.id === assistantMsgId ? { ...msg, content: fullText || `Looking up data (round ${data.round})...` } : msg
        ));
      },
      onDone: (data) => {
        // Finalize the message
        setMessages(m => m.map(msg =>
          msg.id === assistantMsgId ? {
            ...msg,
            content: fullText,
            streaming: false,
            toolWarning: data.toolsUsed?.failures > 0
              ? `Some data lookups failed (${data.toolsUsed.failures} of ${data.toolsUsed.failures + data.toolsUsed.successes})`
              : undefined,
          } : msg
        ));
        // Show subtle pacing notice when near session limit
        if (data.pacing?.remaining <= 3) {
          showToast(`${data.pacing.remaining} message${data.pacing.remaining === 1 ? '' : 's'} left in this session window`, 'info');
        }
        // Track free tier usage
        if (data.freeTier) setFreeTierUsage(data.freeTier);
        setMemoryKey(k => k + 1);
        refreshConversations(); // a brand-new conversation's first message now shows in the list
        setSending(false);
        streamRef.current = null;
        inputRef.current?.focus();
      },
      onError: (error) => {
        hadError = true;
        setErr(error || 'Agent unavailable — try again');
        // Keep the user's message but remove the empty assistant placeholder
        setMessages(m => m.filter(msg => msg.id !== assistantMsgId));
        setSending(false);
        streamRef.current = null;
        inputRef.current?.focus();
      },
    });
  }

  async function findOpportunity() {
    setScanning(true); setErr(''); setOpportunities([]);
    try {
      const d = await api.ai.findOpportunity();
      setOpportunities(d.opportunities ?? []);
      if (d.opportunities?.length === 0) showToast('No strong signals found right now', 'info');
    } catch (e) {
      setErr(e.error || 'Opportunity scan failed');
    }
    setScanning(false);
  }

  function newChat() {
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null; }
    setConvId(makeConvId());
    setMessages([]);
    setErr('');
    setShowConvList(false);
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function deleteConversation(id, e) {
    e?.stopPropagation();
    try { await api.agent.deleteConversation(id); } catch {}
    const convs = await refreshConversations();
    if (id === convId) {
      if (convs.length > 0) openConversation(convs[0].id);
      else newChat();
    }
  }

  const plan = user?.plan ?? 'free';
  const isPaid = plan !== 'free';
  const freeLimitReached = !isPaid && freeTierUsage && freeTierUsage.used >= freeTierUsage.limit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px' }}>TRADING PARTNER</p>
          <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px' }}>Knows your portfolio · Watches the market</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={findOpportunity} disabled={scanning} className="btn btn-amber" style={{ fontSize: 9 }}>
            {scanning ? '...' : 'SCAN'}
          </button>
          <button onClick={newChat} className="btn btn-blue" style={{ fontSize: 9 }}>+ NEW</button>
          <button onClick={() => setShowConvList(v => !v)} className="btn btn-muted" style={{ fontSize: 9 }}>
            CHATS{conversations.length ? ` ${conversations.length}` : ''}
          </button>
        </div>
      </div>

      {/* Conversation switcher — toggled by CHATS. Tap to switch, ✕ to delete. */}
      {showConvList && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', maxHeight: 280, overflowY: 'auto', flexShrink: 0 }}>
          {conversations.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--faint)', padding: '12px 16px', fontStyle: 'italic', margin: 0 }}>No conversations yet. Start typing to begin one.</p>
          ) : conversations.map(c => (
            <div key={c.id} onClick={() => openConversation(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderTop: '1px solid var(--border)', cursor: 'pointer', background: c.id === convId ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: c.id === convId ? 700 : 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                <p style={{ fontSize: 9, color: 'var(--faint)', margin: '1px 0 0' }}>{c.count} message{c.count === 1 ? '' : 's'}</p>
              </div>
              <button onClick={(e) => deleteConversation(c.id, e)} className="btn btn-muted" style={{ fontSize: 10, padding: '3px 8px' }} title="Delete conversation">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Free tier banner — UPGRADE button suppressed until Stripe is wired (LAUNCH_PLAN Phase 0.1) */}
      {!isPaid && (
        <div style={{ padding: '8px 16px', background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
          <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--blue)', fontWeight: 700 }}>FREE TRIAL</span> — {freeTierUsage ? `${freeTierUsage.used}/${freeTierUsage.limit} messages used this month` : `${10} agent messages/month`}. Paid plans coming soon.
          </p>
        </div>
      )}

      {/* Memory viewer — see what the agent remembers */}
      <MemoryViewer showToast={showToast} refreshKey={memoryKey} />

      {/* Opportunity results */}
      {opportunities.length > 0 && (
        <div style={{ padding: '10px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <p style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>AGENT SPOTTED {opportunities.length} {opportunities.length > 1 ? 'OPPORTUNITIES' : 'OPPORTUNITY'}</p>
          {opportunities.map((opp, i) => <OpportunityCard key={i} opp={opp} showToast={showToast} />)}
          <DisclaimerBadge />
        </div>
      )}

      {/* Messages */}
      <div className="scrollable" style={{ flex: 1, padding: '14px 16px 8px', overflowY: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <Message
                key={msg.id || i}
                msg={msg}
                isLast={i === messages.length - 1}
                onSaveToJournal={(m) => setJournalSave({
                  content: m.content,
                  ticker: detectTicker(m.content),
                  sourceRef: m.id ? String(m.id) : null,
                })}
              />
            ))}
            {sending && !messages.some(m => m.streaming && m.content) && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--blue)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', animation: `pulse 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                  <span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 4, animation: 'fadeIn 0.3s' }}>Thinking...</span>
                </div>
              </div>
            )}
            {err && <p style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', marginBottom: 12 }}>{err}</p>}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Starters — only when no messages yet */}
      {!loading && messages.length <= 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 16px 8px', flexShrink: 0 }}>
          {starters.map((s, i) => (
            <button key={i} onClick={() => send(s)} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 11px', fontSize: 10, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', letterSpacing: '0.2px' }}
              onMouseEnter={e => e.target.style.borderColor = 'rgba(59,130,246,0.4)'}
              onMouseLeave={e => e.target.style.borderColor = 'var(--border)'}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <input
          ref={inputRef}
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={freeLimitReached ? 'Monthly message limit reached — upgrade to continue' : 'Ask anything about your portfolio or the market...'}
          style={{ flex: 1, fontSize: 12 }}
          disabled={sending || freeLimitReached}
        />
        <button onClick={() => send()} disabled={!input.trim() || sending || freeLimitReached} className="btn btn-blue" style={{ padding: '8px 14px', opacity: !input.trim() || sending || freeLimitReached ? 0.4 : 1 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>

      {/* Save to Journal sheet — opens when user taps the bookmark on any assistant message */}
      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        initialTicker={journalSave?.ticker || ''}
        source="ai_agent"
        sourceRef={journalSave?.sourceRef || null}
        preferredSectionName="AI Insights"
        showToast={showToast}
      />
    </div>
  );
}
