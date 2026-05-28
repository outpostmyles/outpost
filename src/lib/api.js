const BASE = import.meta.env.VITE_API_URL || '';

function getToken() { return localStorage.getItem('outpost_token'); }

async function request(method, path, body, isFormData = false, retries = 1) {
  const token = getToken();
  const headers = { Authorization: token ? `Bearer ${token}` : '' };
  if (!isFormData) headers['Content-Type'] = 'application/json';

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // Capture the request ID the backend stamped on this response so we
      // can include it in any thrown error. When a beta user reports "the
      // app crashed" we'll have a code that maps to a specific log line.
      const requestId = res.headers.get('X-Request-Id') || null;

      if (res.status === 401) {
        localStorage.removeItem('outpost_token');
        localStorage.removeItem('outpost_user');
        window.dispatchEvent(new Event('auth_expired'));
        throw { error: 'Session expired — please sign in again', status: 401, requestId };
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = { error: data.error || 'Something went wrong', status: res.status, requestId, ...data };
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        lastErr = { error: 'Request timed out — please try again', status: 408 };
        throw lastErr;
      }
      lastErr = err;
      // Don't retry auth errors, client errors, or credit errors
      if (err.status && err.status < 500) throw err;
      // Retry server errors and network failures
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const patch = (path, body) => request('PATCH', path, body);
const del = (path, body) => request('DELETE', path, body);

export const api = {
  auth: {
    signup: (body) => post('/api/auth/signup', body),
    login: (body) => post('/api/auth/login', body),
    logout: () => post('/api/auth/logout'),
    validate: () => get('/api/auth/validate'),
    forgotPassword: (body) => post('/api/auth/forgot-password', body),
    resetPassword: (body) => post('/api/auth/reset-password', body),
    changePassword: (body) => post('/api/auth/change-password', body),
  },
  market: {
    sentiment: () => get('/api/market/sentiment'),
    movers: () => get('/api/market/movers'),
    prices: (tickers) => get(`/api/market/prices?tickers=${tickers.join(',')}`),
    news: (ticker) => get(`/api/market/news?ticker=${ticker}`),
  },
  ai: {
    summary: (opts) => get(`/api/ai/summary${opts?.force ? '?force=true' : ''}`),
    analysis: (ticker, deep = false, force = false) => post('/api/ai/analysis', { ticker, deep, force }),
    findOpportunity: () => post('/api/ai/find-opportunity'),
    news: (ticker) => post('/api/ai/news', { ticker }),
    brief: (opts) => get(`/api/ai/brief${opts?.force ? '?force=true' : ''}`),
    journalCoach: () => get('/api/ai/journal-coach'),
    sectorRadar: (opts) => get(`/api/ai/sector-radar${opts?.force ? '?force=true' : ''}`),
    bargainRadar: (opts) => get(`/api/ai/bargain-radar${opts?.force ? '?force=true' : ''}`),
    moveExplainer: (opts) => get(`/api/ai/move-explainer${opts?.force ? '?force=true' : ''}`),
    proactiveDigest: (opts) => get(`/api/ai/proactive-digest${opts?.force ? '?force=true' : ''}`),
    today: () => get('/api/ai/today'),
    welcome: (body) => post('/api/ai/welcome', body),
    feedback: (body) => post('/api/settings/ai-feedback', body),
    thesisAssist: (body) => post('/api/ai/thesis-assist', body),
    exitReflectionAssist: (body) => post('/api/ai/exit-reflection-assist', body),
    deployCash: (body) => post('/api/ai/deploy-cash', body),
    deployCashCounter: (body) => post('/api/ai/deploy-cash/counter', body),
    deployCashChoice: (body) => post('/api/ai/deploy-cash/choice', body),
  },
  portfolio: {
    value: () => get('/api/portfolio/value'),
    addPosition: (body) => post('/api/portfolio/positions', body),
    editPosition: (id, body) => patch(`/api/portfolio/positions/${id}`, body),
    removePosition: (id, body) => del(`/api/portfolio/positions/${id}`, body),
    closedTrades: () => get('/api/portfolio/closed-trades'),
    snapshots: () => get('/api/portfolio/snapshots'),
    takeSnapshot: () => post('/api/portfolio/snapshot'),
    analyses: () => get('/api/portfolio/analyses'),
    stockDetails: (ticker) => get(`/api/portfolio/stock-details/${ticker}`),
    importPositions: (positions) => post('/api/portfolio/import', { positions }),
    parseScreenshot: (image) => post('/api/portfolio/parse-screenshot', { image }),
    planAdherence: () => get('/api/portfolio/plan-adherence'),
    performanceAttribution: () => get('/api/portfolio/performance-attribution'),
    synthesis: (force = false) => get(`/api/portfolio/synthesis${force ? '?force=true' : ''}`),
    history: (ticker, limit) => get(`/api/portfolio/history/${ticker}${limit ? `?limit=${limit}` : ''}`),
    // Pre-trade sanity check — one sharp question grounded in the user's
    // history with this ticker. Surfaced in AddModal above the thesis field.
    gutCheck: (ticker) => post('/api/portfolio/positions/gut-check', { ticker }),
    // Behavior-outcome attribution — win rate by thesis/stop/target/reflection.
    // Shows "Your Patterns" card on the Journal tab.
    attribution: () => get('/api/portfolio/attribution'),
    // Daily pulse — one short personal sentence at the top of Home. Free tier.
    pulse: () => get('/api/portfolio/pulse'),
  },
  // Conversational onboarding — 3 questions that anchor the user's identity
  // for every future agent turn. Stored as agent_memory(memory_type='onboarding_anchor').
  onboarding: {
    questions: () => get('/api/onboarding/questions'),
    answer: (body) => post('/api/onboarding/answer', body),
    anchors: () => get('/api/onboarding/anchors'),
  },
  alerts: {
    list: () => get('/api/alerts'),
    create: (body) => post('/api/alerts', body),
    update: (id, body) => patch(`/api/alerts/${id}`, body),
    remove: (id) => del(`/api/alerts/${id}`),
  },
  social: {
    buzz: () => get('/api/social/buzz'),
    scan: (category = 'all') => get(`/api/social/scan?category=${category}`),
    catalyst: () => get('/api/social/catalyst'),
    catalystGenerate: (dropId) => post('/api/social/catalyst/generate', { dropId }),
    catalystRecap: () => post('/api/social/catalyst/recap'),
    watchlist: () => get('/api/social/watchlist'),
    addToWatchlist: (body) => post('/api/social/watchlist', body),
    editWatchlistItem: (id, body) => patch(`/api/social/watchlist/${id}`, body),
    removeFromWatchlist: (id) => del(`/api/social/watchlist/${id}`),
  },
  agent: {
    messages: () => get('/api/agent/messages'),
    send: (content) => post('/api/agent/messages', { content }),
    clear: () => del('/api/agent/messages'),
    clearMemories: () => del('/api/agent/memories'),
    memories: () => get('/api/agent/memories'),
    deleteMemory: (id) => del(`/api/agent/memories/${id}`),
    /**
     * Stream a message using SSE. Returns an object with methods to consume the stream.
     * @param {string} content - The message to send
     * @param {object} callbacks - { onText, onStatus, onDone, onError }
     */
    stream: (content, { onText, onStatus, onDone, onError }) => {
      const token = getToken();
      const controller = new AbortController();

      fetch(`${BASE}/api/agent/stream`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            localStorage.removeItem('outpost_token');
            localStorage.removeItem('outpost_user');
            window.dispatchEvent(new Event('auth_expired'));
          }
          onError?.(data.error || 'Agent unavailable');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventType) {
              try {
                const data = JSON.parse(line.slice(6));
                if (eventType === 'text') onText?.(data.text);
                else if (eventType === 'status') onStatus?.(data);
                else if (eventType === 'done') onDone?.(data);
                else if (eventType === 'error') onError?.(data.error);
              } catch {}
              eventType = '';
            } else if (line === '') {
              eventType = '';
            }
          }
        }
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          onError?.(err.message || 'Network error');
        }
      });

      return { abort: () => controller.abort() };
    },
  },
  settings: {
    update: (body) => patch('/api/settings/user', body),
    feedback: (body) => post('/api/settings/feedback', body),
    deleteAccount: (body) => del('/api/settings/account', body),
  },
  journal: {
    listNotes: () => get('/api/journal/notes'),
    getNote: (id) => get(`/api/journal/notes/${id}`),
    createNote: (body) => post('/api/journal/notes', body),
    updateNote: (id, body) => patch(`/api/journal/notes/${id}`, body),
    appendNote: (id, content) => post(`/api/journal/notes/${id}/append`, { content }),
    deleteNote: (id) => del(`/api/journal/notes/${id}`),
    timeline: (params = {}) => {
      const q = new URLSearchParams();
      if (params.ticker) q.set('ticker', params.ticker);
      if (params.topic) q.set('topic', params.topic);
      if (params.dateFrom) q.set('date_from', params.dateFrom);
      if (params.dateTo) q.set('date_to', params.dateTo);
      if (params.sources) q.set('sources', Array.isArray(params.sources) ? params.sources.join(',') : params.sources);
      if (params.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return get(`/api/journal/timeline${qs ? '?' + qs : ''}`);
    },
  },
  admin: {
    check: () => get('/api/admin/check'),
    dashboard: () => get('/api/admin/dashboard'),
    reviewQueue: (opts) => get(`/api/admin/review-queue${opts?.threshold != null ? `?threshold=${opts.threshold}` : ''}`),
    markReviewed: (id, verdict) => post(`/api/admin/review-queue/${id}`, { verdict }),
  },
};
