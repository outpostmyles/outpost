import { useState, useEffect } from 'react';

/**
 * Activation checklist — drives new users to actually USE the app's core features.
 * Derives most completion state from real user data (positions, price targets).
 * Free-tier local flags: agent_talked, radar_visited, dismissed.
 */
export default function ActivationChecklist({ portfolio, userId, plan, onTabSwitch, showToast }) {
  const [localFlags, setLocalFlags] = useState(() => readFlags(userId));

  // Re-read flags when user changes (login switch)
  useEffect(() => { setLocalFlags(readFlags(userId)); }, [userId]);

  // Derive completion from live data
  const hasPosition = (portfolio?.positions?.length ?? 0) > 0;
  const hasTarget = (portfolio?.positions ?? []).some(p => p.price_target != null);
  const hasAgentChat = !!localFlags.agent_talked;
  const hasVisitedRadar = !!localFlags.radar_visited;
  const dismissed = !!localFlags.dismissed;

  const isPaid = plan && plan !== 'free';

  // Build task list — final upgrade task only shows for free users
  const tasks = [
    {
      key: 'position',
      label: 'Add your first position',
      desc: 'Track a stock you own to unlock portfolio analysis',
      done: hasPosition,
      action: () => onTabSwitch?.('portfolio'),
    },
    {
      key: 'agent',
      label: 'Ask your agent a question',
      desc: 'Try "what should I watch today?" — your agent knows your portfolio',
      done: hasAgentChat,
      action: () => { setFlag(userId, 'agent_talked', true); setLocalFlags(f => ({ ...f, agent_talked: true })); onTabSwitch?.('agent'); },
    },
    {
      key: 'target',
      label: 'Set a price target',
      desc: 'Tap any position and set a target — your agent will watch it',
      done: hasTarget,
      action: () => onTabSwitch?.('portfolio'),
      locked: !hasPosition, // can't set target without a position
    },
    {
      key: 'radar',
      label: 'Check the sector radar',
      desc: 'See which sectors are heating up and cooling down',
      done: hasVisitedRadar,
      action: () => { setFlag(userId, 'radar_visited', true); setLocalFlags(f => ({ ...f, radar_visited: true })); },
    },
  ];

  // Upgrade task suppressed until Stripe is wired — see LAUNCH_PLAN Phase 0.1.
  // The task was showing a hardcoded price + plan name and pointed to a flow
  // that doesn't exist yet. Re-enable once the real upgrade path lands.
  // if (!isPaid) {
  //   tasks.push({
  //     key: 'upgrade',
  //     label: 'Unlock unlimited agent + daily AI Brief',
  //     desc: 'Upgrade to Starter — $20/mo for unlimited everything',
  //     done: false,
  //     action: () => showToast?.('Upgrade flow coming soon'),
  //     highlight: true,
  //   });
  // }

  const completed = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const allDone = completed === total;

  // Mark celebrated once when all tasks complete — done in an effect (not during
  // render) so the localStorage write isn't a side-effect of rendering, and
  // setLocalFlags drives the next render where the card hides itself.
  useEffect(() => {
    if (allDone && !localFlags.celebrated && userId) {
      setFlag(userId, 'celebrated', true);
      setLocalFlags(f => ({ ...f, celebrated: true }));
    }
  }, [allDone, localFlags.celebrated, userId]);

  // Auto-hide when dismissed or celebration acknowledged
  if (dismissed) return null;
  if (allDone && localFlags.celebrated) return null;

  function handleDismiss() {
    setFlag(userId, 'dismissed', true);
    setLocalFlags(f => ({ ...f, dismissed: true }));
  }

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px' }}>GET STARTED</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{completed}/{total}</span>
          </div>
          <button onClick={handleDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 14, padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(completed / total) * 100}%`, background: 'var(--blue)', borderRadius: 2, transition: 'width 0.3s ease' }} />
        </div>

        {/* Task list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(task => (
            <button
              key={task.key}
              onClick={task.locked ? undefined : task.action}
              disabled={task.locked}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '9px 10px',
                background: task.highlight ? 'rgba(59,130,246,0.08)' : 'transparent',
                border: task.highlight ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
                borderRadius: 6,
                cursor: task.locked ? 'default' : 'pointer',
                textAlign: 'left',
                opacity: task.locked ? 0.4 : (task.done ? 0.55 : 1),
                fontFamily: 'inherit',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!task.locked && !task.done) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { if (!task.highlight) e.currentTarget.style.background = 'transparent'; else e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; }}
            >
              {/* Checkmark circle */}
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                background: task.done ? 'var(--green)' : 'transparent',
                border: `1.5px solid ${task.done ? 'var(--green)' : (task.highlight ? 'var(--blue)' : 'var(--border)')}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {task.done && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: task.done ? 'var(--muted)' : (task.highlight ? 'var(--blue)' : 'var(--text)'), marginBottom: 2, textDecoration: task.done ? 'line-through' : 'none' }}>
                  {task.label}
                </p>
                {!task.done && (
                  <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>{task.desc}</p>
                )}
              </div>
              {!task.done && !task.locked && (
                <span style={{ color: task.highlight ? 'var(--blue)' : 'var(--faint)', fontSize: 14, flexShrink: 0, marginTop: -1 }}>›</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ——— localStorage helpers ———
const STORAGE_KEY = 'outpost_checklist';

function readFlags(userId) {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw);
    return all[userId] ?? {};
  } catch { return {}; }
}

function setFlag(userId, key, value) {
  if (!userId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[userId] = { ...(all[userId] ?? {}), [key]: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}
