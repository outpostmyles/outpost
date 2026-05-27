// Journal — user's notebook of named notes, like chat conversations.
// Each note has a title and freeform content. Bookmark buttons throughout
// the app append content into a chosen note. Strictly user-owned; NOT
// read by the agent.
import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeString } from '../middleware/validate.js';
import { getUserHistory } from '../services/historyAggregator.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — LONGITUDINAL MEMORY
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/journal/timeline — the user's investing story.
// Unifies events from agent conversations, position opens/closes, theses,
// and journal notes into a single chronological feed. Powers the Timeline
// view on the Journal tab.
//
// Query params (all optional):
//   ticker     — filter to a single ticker
//   topic      — free-text substring across title/excerpt/quote
//   date_from  — ISO date (yyyy-mm-dd or full ISO timestamp)
//   date_to    — ISO date
//   sources    — comma-separated list of: agent, position_open, position_close,
//                thesis, journal. Default = all.
//   limit      — max entries (default 30, hard cap 100)
router.get('/timeline', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const ticker = req.query.ticker ? String(req.query.ticker).toUpperCase().slice(0, 6) : undefined;
    const topic = req.query.topic ? String(req.query.topic).slice(0, 200) : undefined;
    const dateFrom = req.query.date_from ? String(req.query.date_from).slice(0, 30) : undefined;
    const dateTo = req.query.date_to ? String(req.query.date_to).slice(0, 30) : undefined;
    const sourcesParam = req.query.sources ? String(req.query.sources) : undefined;
    const allowedSources = ['agent', 'position_open', 'position_close', 'thesis', 'journal', 'deploy_cash'];
    const sources = sourcesParam
      ? sourcesParam.split(',').map(s => s.trim()).filter(s => allowedSources.includes(s))
      : allowedSources;
    const limitRaw = req.query.limit ? parseInt(req.query.limit, 10) : 30;
    const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 30 : limitRaw), 100);

    const events = await getUserHistory({
      userId: req.user.id,
      ticker, topic, dateFrom, dateTo, sources, limit,
    });

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('[Journal] /timeline failed:', err.message);
    res.status(500).json({ error: 'Timeline unavailable' });
  }
});

const MAX_TITLE = 80;
const MAX_CONTENT = 50000;           // Notes can grow large — they're documents
const MAX_NOTES_PER_USER = 500;

// List all notes for current user — newest updated first.
// Returns title + preview (first ~120 chars) to keep the list payload small.
router.get('/notes', requireAuth, rateLimit(60), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('journal_notes')
      .select('id, title, content, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const notes = (data ?? []).map(n => ({
      id: n.id,
      title: n.title,
      preview: (n.content || '').slice(0, 140),
      created_at: n.created_at,
      updated_at: n.updated_at,
    }));
    res.json({ notes });
  } catch (err) {
    console.error('[Journal] list notes:', err.message);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

// Get a single note with full content.
router.get('/notes/:id', requireAuth, rateLimit(120), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('journal_notes')
      .select('id, title, content, created_at, updated_at')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Note not found' });
    res.json({ note: data });
  } catch (err) {
    console.error('[Journal] get note:', err.message);
    res.status(500).json({ error: 'Failed to load note' });
  }
});

// Create a new note.
router.post('/notes', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const title = sanitizeString(req.body.title, MAX_TITLE) || 'Untitled';
    const content = req.body.content ? sanitizeString(req.body.content, MAX_CONTENT) : '';

    // Soft cap so one user can't balloon the table
    const { count } = await supabase
      .from('journal_notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id);
    if ((count ?? 0) >= MAX_NOTES_PER_USER) {
      return res.status(400).json({ error: `Max ${MAX_NOTES_PER_USER} notes reached — delete some to add more` });
    }

    const { data, error } = await supabase
      .from('journal_notes')
      .insert({ user_id: req.user.id, title, content })
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    console.error('[Journal] create note:', err.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update a note (title and/or content).
router.patch('/notes/:id', requireAuth, rateLimit(120), async (req, res) => {
  try {
    const updates = { updated_at: new Date().toISOString() };

    if (req.body.title !== undefined) {
      const clean = sanitizeString(req.body.title, MAX_TITLE);
      updates.title = clean || 'Untitled';
    }
    if (req.body.content !== undefined) {
      // Allow empty content — user can clear a note
      updates.content = sanitizeString(req.body.content, MAX_CONTENT) || '';
    }
    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data, error } = await supabase
      .from('journal_notes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Note not found' });
    res.json({ note: data });
  } catch (err) {
    console.error('[Journal] update note:', err.message);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Append content to an existing note. Used by bookmark saves throughout the app.
// Adds a divider + timestamp header so the note stays readable as it grows.
router.post('/notes/:id/append', requireAuth, rateLimit(60), async (req, res) => {
  try {
    const addition = sanitizeString(req.body.content, MAX_CONTENT);
    if (!addition) return res.status(400).json({ error: 'Content required' });

    // Fetch current note to append to
    const { data: current, error: fetchErr } = await supabase
      .from('journal_notes')
      .select('id, content')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!current) return res.status(404).json({ error: 'Note not found' });

    // Format the append block with a divider + local timestamp
    const stamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const block = `${current.content ? '\n\n---\n' : ''}${stamp}\n\n${addition}`;
    const newContent = (current.content || '') + block;

    // Respect size ceiling — truncate old content if we'd overflow
    const finalContent = newContent.length > MAX_CONTENT
      ? newContent.slice(newContent.length - MAX_CONTENT)
      : newContent;

    const { data, error } = await supabase
      .from('journal_notes')
      .update({ content: finalContent, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ note: data });
  } catch (err) {
    console.error('[Journal] append note:', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Delete a note.
router.delete('/notes/:id', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const { error } = await supabase
      .from('journal_notes')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[Journal] delete note:', err.message);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

export default router;
