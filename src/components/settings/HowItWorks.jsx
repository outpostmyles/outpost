import { Modal } from '../shared/UI.jsx';

/**
 * "How Outpost works" — single reference page reachable from Settings.
 * Plain prose, organized by feature, no marketing fluff. Designed to answer
 * the questions users actually have:
 *   - What's the AI brief vs the agent vs an AI read?
 *   - What are credits and how do they get used?
 *   - What's a trade plan and why would I set one?
 *   - What's the journal for? Does the AI read it?
 *   - What's TODAY?
 *
 * Stays in plain text — no clickable deep links, no inline tutorials. The
 * user can read this once and have a clear mental model.
 */
export default function HowItWorks({ onClose }) {
  return (
    <Modal title="How Outpost works" onClose={onClose}>
      <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>

        <Section title="The big idea">
          Outpost watches your portfolio so you don't have to. Each morning we summarize what changed,
          flag what matters, and answer "should I worry?" honestly when you tap a position. Calm during
          ordinary noise, sharp when something is genuinely broken.
        </Section>

        <Section title="TODAY (Home tab)">
          Five ranked picks — the most important things across your portfolio, watchlist, sectors, bargains,
          and market movers. Refreshed every hour. Tap any row to dive deeper into the source. Free for
          all users.
        </Section>

        <Section title="The AI Brief (Home tab)">
          A personal three-sentence pre-market read sent every weekday morning at 7:30 AM ET. Reads
          your style and risk tolerance, factors in your positions and any active alerts, and tells you
          what's worth watching today. Paid plans only.
        </Section>

        <Section title="AI Reads (Portfolio tab)">
          Tap any position card and you'll see "Get AI read." That gives you a calm three-sentence
          take on what's happening with that ticker today — distinguishing stock-specific news from
          broader market moves, addressing real drawdowns honestly, and saying "no action needed"
          when that's the right answer. Cached for the day so you can re-tap free. Paid plans only.
        </Section>

        <Section title="The Agent (Agent tab)">
          A full chat that knows your portfolio. Ask anything: "what should I be watching today?",
          "should I worry about NVDA?", "find me something interesting in semis." It reads your
          positions, watchlist, trade plans, and recent closed trades. It does not read your journal.
        </Section>

        <Section title="Trade plans">
          On any position, you can set an entry thesis, price target, and stop loss. These are
          structured, anchored to that specific trade. The agent reads them — when it talks about
          NVDA, it'll reference your thesis and where the price is relative to your target/stop.
          Optional. The app works fine without them.
        </Section>

        <Section title="The Journal (Journal tab)">
          Your private scratchpad. Bookmark AI responses you want to revisit, jot down ideas, save
          news headlines. The agent does NOT read free-form journal notes — they're for you, not for
          training. Trade plans on positions are the structured channel that does inform the AI.
        </Section>

        <Section title="Credits">
          AI features cost credits. Each plan gets a monthly allotment. Cached responses don't
          re-charge — tapping the same position twice in a day costs once. Most users never come
          close to their cap. Settings shows your usage.
        </Section>

        <Section title="What the agent is good at">
          Synthesizing what's happening across your holdings. Explaining moves in context.
          Distinguishing real risk from noise. Remembering what you wrote on past trades.
        </Section>

        <Section title="What the agent is not">
          A real-time data terminal. A signal-trading bot. A financial advisor. A replacement for
          your own judgment. Outpost is educational and informational only — every output ends with
          a disclaimer for a reason.
        </Section>

      </div>
      <button onClick={onClose} className="btn btn-muted btn-full" style={{ marginTop: 16 }}>Close</button>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 6 }}>{title}</h3>
      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.65 }}>{children}</p>
    </div>
  );
}
