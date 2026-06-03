// The single source of truth for a user's cash balance.
//
// The account is cash + holdings. Cash lives in agent_memory as a per-user JSON
// singleton, the same no-migration pattern the North Star goal uses. Closing a
// position credits its proceeds here, a funded buy debits it, and the user can
// set it to match their brokerage. Never goes negative.
//
// Extracted out of the portfolio routes so every surface that needs to know the
// real account value (the /value endpoint, the agent's North Star framing, the
// daily digest email) reads cash the exact same way, instead of each re-deriving
// it or ignoring it.
import { supabase } from '../db.js';

export async function getCashBalance(userId) {
  try {
    const { data } = await supabase.from('agent_memory')
      .select('content').eq('user_id', userId).eq('memory_type', 'cash_balance')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.content) return 0;
    const amt = Number(JSON.parse(data.content)?.amount);
    return Number.isFinite(amt) && amt >= 0 ? amt : 0;
  } catch { return 0; }
}

export async function setCashBalance(userId, amount) {
  const amt = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
  await supabase.from('agent_memory').delete().eq('user_id', userId).eq('memory_type', 'cash_balance');
  await supabase.from('agent_memory').insert({ user_id: userId, memory_type: 'cash_balance', content: JSON.stringify({ amount: amt }), created_at: new Date().toISOString() });
  return amt;
}

export async function adjustCashBalance(userId, delta) {
  const cur = await getCashBalance(userId);
  return setCashBalance(userId, Math.max(0, cur + (Number(delta) || 0)));
}
