// Detects the two highest-stakes moments in a user's message to the agent, so the
// route can inject a forcing directive onto that turn: a crisis offramp (self-harm
// signals) or a hold-the-line directive on a life-altering money move. The spine
// rules also live in the system prompt, but a prompt can drift under heavy emotional
// pressure, which is exactly when these moments occur. This structural layer does
// not depend on the model remembering a rule. Pure and unit-tested.

// Large, hard-to-reverse money moves, or risking money the user may need.
const HIGH_STAKES_RE = /\b(sell(ing)? everything|sell it all|sold everything|liquidat\w+ (everything|it all|my whole|the whole|my entire|the entire|my account|my portfolio)|cash(ing)? out everything|go(ing)? all[ -]in|all[ -]in (on|here)|life savings|retirement (savings|account|money|fund)|everything i (have|own|got)|my (whole|entire) (portfolio|account|savings|net worth)|can'?t afford to lose|money i need|money for (rent|bills|food|groceries)|rent money|put everything|bet everything|max(ing|ed)? out|take out a loan|borrow to (buy|invest)|remortgage)\b/i;

// Self-harm / crisis signals. Wellbeing comes before any market content.
const CRISIS_RE = /\b(kill myself|killing myself|end(ing)? it all|end(ing)? my life|suicid\w+|don'?t want to (be here|live|exist)|no reason to live|nothing to live for|hurt myself|harm myself|better off dead|can'?t go on|want to die(?! laughing| of laughter))\b/i;

/**
 * Classify a user message. Returns 'crisis' | 'high_stakes' | null.
 * Crisis always takes precedence over a money move.
 */
export function classifyHighStakes(text) {
  if (typeof text !== 'string' || !text) return null;
  if (CRISIS_RE.test(text)) return 'crisis';
  if (HIGH_STAKES_RE.test(text)) return 'high_stakes';
  return null;
}

// The directives injected onto the user's turn for each class.
export const GUARDRAIL_DIRECTIVES = {
  crisis: '[CRISIS SIGNAL in the user\'s message. Before anything else, and instead of any market or trading content this turn: acknowledge what they are feeling, tell them plainly that they matter and they are not alone, and let them know they can reach the 988 Suicide and Crisis Lifeline right now (call or text 988 in the US) or reach someone they trust today. Be human and brief. Do NOT give portfolio or trading analysis in this reply. Their wellbeing comes before any market question.]',
  high_stakes: '[HIGH-STAKES MONEY MOMENT: the user is talking about a large, hard-to-reverse move (liquidating everything, going all in, or risking money they may need). Do NOT cheerlead it. Say plainly that this is a big move that is hard to undo. Hold your line: if it reads as driven by panic or feeling rather than a written plan, say so honestly instead of validating it. Ask for the two numbers that turn a reaction into a plan: the re-entry trigger, and the price or event that means "I was wrong". Never grade it as smart or well-executed; the outcome has not happened. Never invent a comforting number. Mention once, briefly, that a move this size is worth talking through with a licensed advisor too, then give them your straight, honest read.]',
};
