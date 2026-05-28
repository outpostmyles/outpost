// Conversational onboarding — the first-5-minutes value moment.
//
// Replaces the old import-positions-or-fill-form first impression with three
// open-ended questions that capture identity/anchor data the agent uses
// forever after. Stored in agent_memory with memory_type='onboarding_anchor'
// so they're surfaced as durable context in every subsequent agent turn.
//
// The questions are intentionally hardcoded on the frontend — no AI is
// required to ASK them. AI is only called for the personalized welcome
// message (existing /api/ai/welcome endpoint, enhanced to read anchors).
//
// Why agent_memory and not a new table: it's already wired into the agent
// context pipeline via formatMemories(). One fewer migration, one fewer
// place to forget about when reasoning about user data.
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { saveMemory } from '../services/agentMemory.js';
import { supabase } from '../db.js';

const router = express.Router();

// Cap on stored onboarding answer length. Long enough for thoughtful answers,
// short enough that bad inputs can't bloat the agent prompt or DoS us.
const MAX_ANSWER_CHARS = 800;

// The three questions are returned to the client so the client can show
// progress + read them back during display, AND so we can change them
// server-side without a frontend redeploy. Treat as the source of truth.
const QUESTIONS = [
  {
    idx: 0,
    prompt: 'What made you start investing?',
    placeholder: 'Maybe a story, maybe a goal, maybe just curiosity. Whatever\'s true.',
    minWords: 3,
  },
  {
    idx: 1,
    prompt: 'What\'s a stock you wish you\'d bought — and what stopped you?',
    placeholder: 'No wrong answer. The "what stopped you" part is the useful one.',
    minWords: 3,
  },
  {
    idx: 2,
    prompt: 'What scares you most about the market right now?',
    placeholder: 'A specific worry beats a generic one. We\'ll come back to this.',
    minWords: 3,
  },
];

// GET /api/onboarding/questions — returns the question list. Public to the
// client so it can render even before the user submits the first answer.
router.get('/questions', requireAuth, (req, res) => {
  res.json({ questions: QUESTIONS });
});

// POST /api/onboarding/answer — stores one answer as an onboarding_anchor
// memory. Idempotent at the conversation level: if the user re-submits a
// question they already answered, we overwrite. (Onboarding can be retried
// on connection blip.)
router.post('/answer', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const { questionIdx, answer } = req.body ?? {};
    const idx = parseInt(questionIdx, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= QUESTIONS.length) {
      return res.status(400).json({ error: 'Invalid question index' });
    }
    const q = QUESTIONS[idx];

    if (typeof answer !== 'string') {
      return res.status(400).json({ error: 'Answer must be a string' });
    }
    const trimmed = answer.trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Answer cannot be empty' });
    }
    // Min word count guard — single-word answers like "money" don't anchor
    // anything useful and we'd rather make the user think.
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount < (q.minWords ?? 3)) {
      return res.status(400).json({ error: `Give us a bit more — at least ${q.minWords} words. The depth is the point.` });
    }
    if (trimmed.length > MAX_ANSWER_CHARS) {
      return res.status(400).json({ error: `Keep it under ${MAX_ANSWER_CHARS} characters.` });
    }

    // Format the stored content as "Q: ... | A: ..." so when the agent
    // reads it in context it has both halves and can quote the question.
    // saveMemory dedupes same-content-within-24h so re-submits are safe.
    //
    // We delete any prior answer for this same question index first, so a
    // user editing question 1 doesn't end up with two competing anchors.
    await supabase
      .from('agent_memory')
      .delete()
      .eq('user_id', req.user.id)
      .eq('memory_type', 'onboarding_anchor')
      .like('content', `Q${idx}:%`);

    await saveMemory(req.user.id, {
      type: 'onboarding_anchor',
      content: `Q${idx}: ${q.prompt} | A: ${trimmed}`,
    });

    res.json({ ok: true, questionIdx: idx, totalQuestions: QUESTIONS.length });
  } catch (err) {
    console.error(`[req:${req.requestId}] [Onboarding] /answer failed:`, err.message);
    res.status(500).json({ error: 'Could not save your answer — try again in a moment.' });
  }
});

// GET /api/onboarding/anchors — returns the stored anchors for the current
// user. Used by /api/ai/welcome to personalize the welcome message. Could
// also be used by Settings to let the user re-read their own answers later.
router.get('/anchors', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('agent_memory')
      .select('content, created_at')
      .eq('user_id', req.user.id)
      .eq('memory_type', 'onboarding_anchor')
      .order('created_at', { ascending: true });
    res.json({ anchors: data ?? [] });
  } catch (err) {
    console.error(`[req:${req.requestId}] [Onboarding] /anchors failed:`, err.message);
    res.json({ anchors: [] }); // non-critical — return empty rather than 500
  }
});

export default router;

// Parser helper: given the raw "Qn: ... | A: ..." content format we store,
// returns { idx, question, answer }. Exported for tests + welcome service.
export function parseAnchor(content) {
  if (!content || typeof content !== 'string') return null;
  const m = content.match(/^Q(\d+):\s*(.+?)\s*\|\s*A:\s*([\s\S]+)$/);
  if (!m) return null;
  return {
    idx: parseInt(m[1], 10),
    question: m[2].trim(),
    answer: m[3].trim(),
  };
}
