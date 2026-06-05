import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { goalProgress } from '../../lib/goalProgress.js';
import { projectGoal } from '../../lib/goalProjection.js';

// The North Star: the account value that means financial freedom to this user.
// Orients the app around their destination, not just today's balance.
// `currentValue` is passed in already loaded and is ACCOUNT value (holdings +
// cash), not holdings only, so closing a position into cash does not make the
// goal look further away. This component only fetches the goal and snapshots.

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0';
  return `$${Math.round(n).toLocaleString()}`;
}

export default function NorthStarCard({ currentValue }) {
  const [goal, setGoal] = useState(undefined); // undefined = loading, null = none set
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.portfolio.getGoal(), api.portfolio.snapshots()]).then(([gR, sR]) => {
      if (cancelled) return;
      setGoal(gR.status === 'fulfilled' ? (gR.value?.goal || null) : null);
      setSnapshots(sR.status === 'fulfilled' ? (sR.value?.snapshots || []) : []);
    });
    return () => { cancelled = true; };
  }, []);

  function openEdit() {
    setAmount(goal?.amount ? String(goal.amount) : '');
    setLabel(goal?.label || '');
    setEditing(true);
  }

  async function save() {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) { setErr('Enter a target amount above zero.'); return; }
    setSaving(true); setErr('');
    try {
      const d = await api.portfolio.setGoal({ amount: amt, label: label.trim() || undefined });
      setGoal(d?.goal || { amount: amt, label: label.trim() });
      setEditing(false);
    } catch (e) {
      setErr(e?.error || 'Could not save. If the app was just updated, restart the backend and try again.');
    }
    setSaving(false);
  }

  if (goal === undefined) return null; // loading: render nothing to avoid flicker

  const prog = goal ? goalProgress(currentValue, goal.amount) : null;
  const proj = goal ? projectGoal({ snapshots, current: currentValue, target: goal.amount }) : null;

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--text)', margin: 0 }}>YOUR NORTH STAR</p>
        {goal && !editing && (
          <button onClick={openEdit} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.5px' }}>EDIT</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="input" type="number" inputMode="decimal" placeholder="Target value, e.g. 500000" value={amount} onChange={e => setAmount(e.target.value)} />
          <input className="input" placeholder="What it means to you (optional)" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditing(false)} className="btn btn-muted" style={{ flex: 1, fontSize: 11 }}>Cancel</button>
            <button onClick={save} disabled={saving || !(parseFloat(amount) > 0)} className="btn btn-blue" style={{ flex: 1, fontSize: 11 }}>{saving ? 'Saving...' : 'Set it'}</button>
          </div>
          {err && <p style={{ fontSize: 10, color: 'var(--red)', margin: 0, lineHeight: 1.5 }}>{err}</p>}
        </div>
      ) : !goal ? (
        <>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
            Name the number that means freedom to you. Every round becomes a step toward it.
          </p>
          <button onClick={openEdit} className="btn btn-blue" style={{ fontSize: 11, padding: '7px 16px' }}>Set your number</button>
        </>
      ) : (
        <>
          <div style={{ height: 8, background: 'var(--raised)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
            <div className="grow-in" style={{ width: `${prog.pct}%`, height: '100%', background: prog.reached ? 'var(--green)' : 'var(--blue)', borderRadius: 4, transition: 'width 0.4s' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700, margin: 0 }}>
              {prog.reached ? 'You hit your number.' : `${prog.pct}% to ${fmtMoney(goal.amount)}`}
            </p>
            {!prog.reached && <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0, whiteSpace: 'nowrap' }}>{fmtMoney(prog.remaining)} to go</p>}
          </div>
          {goal.label && <p style={{ fontSize: 10, color: 'var(--faint)', margin: '4px 0 0', fontStyle: 'italic' }}>{goal.label}</p>}
          {proj?.onTrack && proj.yearsAway != null && !prog.reached && (
            <p style={{ fontSize: 10, color: 'var(--faint)', margin: '6px 0 0', lineHeight: 1.5 }}>
              {proj.yearsAway <= 40
                ? `On your recent pace, about ${proj.yearsAway} ${proj.yearsAway === 1 ? 'year' : 'years'} to go. Markets vary, but every round adds up.`
                : 'A long way at this pace, but it compounds. Keep stacking.'}
            </p>
          )}
          {proj && proj.enoughData && proj.onTrack === false && !prog.reached && (
            <p style={{ fontSize: 10, color: 'var(--faint)', margin: '6px 0 0', lineHeight: 1.5 }}>
              Flat lately. The journey isn't a straight line.
            </p>
          )}
        </>
      )}
    </div>
  );
}
