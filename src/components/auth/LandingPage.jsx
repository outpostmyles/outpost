// LandingPage. Public marketing page shown to unauthenticated visitors.
// Hybrid framing: advisor (calm reads, plan accountability) + research tool
// (catalysts, discovery, news on your book). Leads with the active retail
// investor (20-40 positions, daily check-ins) since that's the prototype
// user. No em-dashes anywhere. Voice is direct, declarative, punchy.

const SECTION_PAD = '64px 24px';
const MAX_WIDTH = 720;

const wrap = { maxWidth: MAX_WIDTH, margin: '0 auto' };

function PrimaryButton({ children, onClick, variant = 'primary', size = 'lg' }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      style={{
        background: isPrimary ? 'var(--blue)' : 'transparent',
        color: isPrimary ? '#fff' : 'var(--text)',
        border: isPrimary ? 'none' : '1px solid rgba(255,255,255,0.2)',
        padding: size === 'lg' ? '14px 28px' : '10px 18px',
        borderRadius: 8,
        fontSize: size === 'lg' ? 14 : 12,
        fontWeight: 700,
        letterSpacing: '0.5px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (isPrimary) e.currentTarget.style.background = '#2563eb';
        else e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={e => {
        if (isPrimary) e.currentTarget.style.background = 'var(--blue)';
        else e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function FeatureBlock({ label, title, body }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border)',
      borderLeft: '2px solid var(--blue)',
      borderRadius: 8,
      padding: '18px 20px',
      marginBottom: 12,
    }}>
      <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 6 }}>{label}</p>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.3px' }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>{body}</p>
    </div>
  );
}

// PulseMockup. A CSS-only preview of the Pulse card the user sees inside the
// app. Lives on the landing page between the hero and the feature blocks so
// visitors get a "show, don't tell" moment before reading any feature copy.
// Keeps the terminal aesthetic (mono-feel header, blue dot, muted body) so it
// looks like a real screenshot of the product, not stock marketing imagery.
function PulseMockup() {
  return (
    <div style={{
      background: 'linear-gradient(180deg, #0e0e14, #08080c)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '22px 18px 18px',
      maxWidth: 360,
      margin: '0 auto',
      boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,130,246,0.05)',
    }}>
      {/* Fake phone frame top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, opacity: 0.45 }}>
        <span style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>TERMINAL</span>
        <span style={{ fontSize: 8, color: 'var(--faint)' }}>9:32 AM</span>
      </div>
      {/* The Pulse card itself, rendered exactly like in the app */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))',
        border: '1px solid rgba(59,130,246,0.18)',
        borderRadius: 10,
        padding: '14px 15px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)',
            animation: 'lpDot 2s ease-in-out infinite',
          }} />
          <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '1.3px', fontWeight: 700 }}>OUTPOST</p>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, letterSpacing: '-0.1px', margin: 0 }}>
          NVDA pulled back 3% on Nvidia conference noise. That's the kind of dip you said scared you, but you're still up 18% from your cost. Earnings aren't until Aug 28.
        </p>
        <style>{`@keyframes lpDot { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
      </div>
      {/* Caption under the card */}
      <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', marginTop: 14, lineHeight: 1.5, fontStyle: 'italic' }}>
        What you see when you open Outpost. Personal, calm, specific. Pulled from your own answers and your live book.
      </p>
    </div>
  );
}

// SplitCompare. "Without Outpost / With Outpost" side-by-side, two short
// stories of the same moment. Designed to read like a tweet thread, not a
// feature grid. Keeps the page from feeling like a wall of paragraphs.
function SplitCompare() {
  const cellBase = {
    padding: '20px 18px',
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.6,
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
      <div style={{
        ...cellBase,
        background: 'rgba(239,68,68,0.04)',
        border: '1px solid rgba(239,68,68,0.15)',
        borderLeft: '2px solid var(--red)',
      }}>
        <p style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 8 }}>WITHOUT OUTPOST</p>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          NVDA drops 6%. You panic. You sell. You watch it run 22% the next month without you. Next time you buy NVDA you don't remember why you sold the last one. You make the same call again.
        </p>
      </div>
      <div style={{
        ...cellBase,
        background: 'rgba(34,197,94,0.04)',
        border: '1px solid rgba(34,197,94,0.18)',
        borderLeft: '2px solid var(--green)',
      }}>
        <p style={{ fontSize: 9, color: 'var(--green)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 8 }}>WITH OUTPOST</p>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          NVDA drops 6%. Outpost shows you the thesis you wrote 90 days ago, before the dip. "I'm buying for the AI capex story. Will exit if Q3 capex commentary softens." Capex commentary hasn't softened. You hold. NVDA runs 22%. You're still in.
        </p>
      </div>
    </div>
  );
}

export default function LandingPage({ onGetStarted, onOpenGuide }) {
  return (
    <div style={{
      height: '100vh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: '#08080c',
      color: 'var(--text)',
      fontFamily: 'inherit',
    }}>

      {/* Top nav */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 24px' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 72 72" fill="none">
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
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)' }}>OUTPOST</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={onGetStarted}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 4 }}
            >
              Sign in
            </button>
            <PrimaryButton onClick={onGetStarted} size="sm">Get started</PrimaryButton>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ padding: SECTION_PAD, textAlign: 'left' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '2px', marginBottom: 16 }}>
            BUILT FOR RETAIL INVESTORS
          </p>
          <h1 style={{
            fontSize: 'clamp(36px, 8vw, 56px)',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-1px',
            color: 'var(--text)',
            marginBottom: 24,
          }}>
            The trading partner<br/>who remembers.
          </h1>
          <p style={{
            fontSize: 17,
            color: 'var(--muted)',
            lineHeight: 1.5,
            maxWidth: 560,
            marginBottom: 32,
          }}>
            Outpost asks why you bought it. Writes down what you said. Quotes you back to yourself the next time you're about to break your own plan. No human advisor does that for under $50K. No Reddit thread does it at all. ChatGPT forgets you tomorrow.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <PrimaryButton onClick={onGetStarted}>Get started, free</PrimaryButton>
            <button
              onClick={onOpenGuide}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 4 }}
            >
              Read the founder's guide →
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 20 }}>
            No credit card. Free tier covers your first portfolio.
          </p>
        </div>
      </div>

      {/* Product mockup. Shows what the actual Pulse card looks like inside
          the app so visitors get a "show, don't tell" moment before reading
          any feature copy. Lives between the hero and the WHY THIS EXISTS
          section. */}
      <div style={{ padding: '40px 24px 56px', borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 18, textAlign: 'center' }}>WHAT YOU OPEN TO</p>
          <PulseMockup />
        </div>
      </div>

      {/* The problem */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>WHY THIS EXISTS</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 18, letterSpacing: '-0.5px', lineHeight: 1.2 }}>
            Retail does this the hard way.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 14 }}>
            You check Webull for prices. Reddit for vibes. Twitter for catalysts. ChatGPT for theory. None of them know what you actually own. None of them remember what you said you'd do at your stop. None of them are putting the picture together for you.
          </p>
          <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 14 }}>
            Wealthy investors don't deal with this. Their advisors do all of it. With full context. Daily.
          </p>
          <p style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.65, fontWeight: 500 }}>
            Outpost is what your advisor would be. Without the 1% fee.
          </p>
        </div>
      </div>

      {/* Without / With Outpost. A two-story split. Reads like a tweet
          thread, not a feature grid. Concrete, specific, emotionally honest
          about the loop the app is built to break. */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>SAME MOMENT, TWO ENDINGS</p>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', marginBottom: 22, letterSpacing: '-0.5px', lineHeight: 1.2 }}>
            The expensive habit retail has.
          </h2>
          <SplitCompare />
          <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 18, lineHeight: 1.55 }}>
            Outpost doesn't pick stocks. It makes sure the work you already do shows up at the moment you need it most.
          </p>
        </div>
      </div>

      {/* What Outpost is. Re-cut to lead with the actual differentiators:
          memory, the thesis loop, deploy cash. The original five-jobs lineup
          was accurate but undersold the parts no other app does. */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>WHAT IT DOES</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 24, letterSpacing: '-0.5px', lineHeight: 1.2 }}>
            One app. The five things that move the needle.
          </h2>

          <FeatureBlock
            label="THE MEMORY"
            title="Quotes your own words back to you when it matters."
            body="Every thesis you write, every reflection you log, every conversation you have with the agent. All of it stays. When you ask about a ticker you traded last year, Outpost reads you what you said back then. So the same lesson doesn't have to be learned twice."
          />
          <FeatureBlock
            label="THE THESIS LOOP"
            title="You write why you bought it. We ask about it later."
            body="On add, Outpost asks why this trade. On close, Outpost asks what played out and what you learned. Over time, your Patterns tab shows your win rate WITH a thesis versus WITHOUT. Most retail traders never see that delta. Yours becomes visible."
          />
          <FeatureBlock
            label="THE DAILY READ"
            title="A pulse line on open. A real brief at 7:30am."
            body="Open the app. One sentence at the top tells you what's notable in your book right now. Paid users also get a 3-sentence pre-market brief every weekday, tuned to your style, your risk, your specific positions. Personal, not generic."
          />
          <FeatureBlock
            label="DEPLOY CASH"
            title="Got cash sitting. Tell us your filters."
            body="Aggressive or conservative. Income or growth. Timeframe. Outpost pulls 3 picks that fit YOUR book, not a generic top-stocks list. Server-side concentration caps mean it won't suggest dumping 30% of your portfolio into one name even if you ask aggressive."
          />
          <FeatureBlock
            label="PLAN ACCOUNTABILITY"
            title="You set the target and stop. We hold you to them."
            body="Write down what you'll do at $X up and $Y down. When the price gets there, Outpost reminds you what you said. Pre-trade gut-checks ask one sharp question rooted in your history before you add the position. Three timed catalyst drops a day so you're not doom-scrolling for news."
          />
        </div>
      </div>

      {/* Who this is for / not for */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>HONEST FIT</p>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 24, letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            This is a tool, not a magic button.
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div style={{ padding: '16px 20px', background: 'rgba(34,197,94,0.04)', borderLeft: '2px solid var(--green)', borderRadius: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>YOU IF</p>
              <ul style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                <li>You manage your own portfolio. 5 positions or 50.</li>
                <li>You actually research what you buy.</li>
                <li>You've made decisions in panic that you regretted.</li>
                <li>You want context, not stock tips.</li>
              </ul>
            </div>

            <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.04)', borderLeft: '2px solid var(--red)', borderRadius: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>NOT YOU IF</p>
              <ul style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                <li>You day-trade and need execution speed.</li>
                <li>You want stock picks or signals to follow blindly.</li>
                <li>You've never bought a stock. Open a broker first.</li>
                <li>You want AI to make decisions for you.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>PRICING</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>
            Start free.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
            Free tier covers your first portfolio. Paid plans add the morning brief, deep analysis, and unlimited reads.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ padding: '20px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>FREE</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>$0</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>Try it. See if it fits.</p>
              <ul style={{ paddingLeft: 16, color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                <li>Daily Pulse on open</li>
                <li>Up to 10 positions</li>
                <li>Thesis loop and Patterns view</li>
                <li>AI reads on positions (limited)</li>
                <li>Catalysts and sector heat</li>
                <li>Trade plan tracking</li>
              </ul>
            </div>

            <div style={{ padding: '20px', border: '1px solid var(--blue)', borderRadius: 8, background: 'rgba(59,130,246,0.04)' }}>
              <p style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>PRO · COMING SOON</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>$12<span style={{ fontSize: 14, color: 'var(--faint)', fontWeight: 400 }}>/mo</span></p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>The full advisor experience.</p>
              <ul style={{ paddingLeft: 16, color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                <li>Unlimited positions</li>
                <li>Unlimited AI reads</li>
                <li>Daily pre-market brief at 7:30am</li>
                <li>Deploy Cash recommendations</li>
                <li>Weekly recap email</li>
                <li>Deep analysis on any position</li>
                <li>Priority support</li>
              </ul>
            </div>
          </div>

          <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 18, lineHeight: 1.5 }}>
            For comparison: a real advisor charges 1% of your portfolio per year. On a $50K book that's $42 a month. Outpost is built for the people that math doesn't work for.
          </p>
        </div>
      </div>

      {/* Founder note teaser */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>FROM THE FOUNDER</p>
          <p style={{ fontSize: 17, color: 'var(--text)', lineHeight: 1.6, marginBottom: 18 }}>
            "I built it because it's the tool I needed. I'd spend hours pulling info on my holdings across five different apps. Nothing knew what I owned. Nothing remembered what I was thinking. So I built the version that does."
          </p>
          <button
            onClick={onOpenGuide}
            style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0, fontWeight: 600 }}
          >
            Read how I use it daily →
          </button>
        </div>
      </div>

      {/* Final CTA */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <div style={wrap}>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)', marginBottom: 12, letterSpacing: '-0.5px', lineHeight: 1.15 }}>
            Stop trading alone.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
            Three questions, ninety seconds. We'll be a way better partner.
          </p>
          <PrimaryButton onClick={onGetStarted}>Get started, free</PrimaryButton>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '24px', borderTop: '1px solid var(--border)' }}>
        <div style={{ ...wrap, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>
            © Outpost. Educational tool, not financial advice.
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            <button onClick={onOpenGuide} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Founder's guide</button>
            <button onClick={onGetStarted} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
