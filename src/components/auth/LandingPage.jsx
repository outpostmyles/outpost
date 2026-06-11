// LandingPage. Public marketing page for unauthenticated visitors.
//
// Terminal aesthetic, elevated: a glow-lit hero, an atmospheric ticker tape, a
// phone mock that cycles real product cards, scroll-reveal motion, and tight,
// declarative copy. The job is one feeling in five seconds: this is a calm,
// personal trading terminal that remembers you. No em or en dashes anywhere.
// Voice is direct and punchy. Every claim maps to something the app truly does.

import { useState, useEffect, useRef } from 'react';

const MAX_WIDTH = 760;
const wrap = { maxWidth: MAX_WIDTH, margin: '0 auto' };
const SECTION_PAD = '72px 24px';

// ─── Scroll reveal: fade-and-rise each block as it enters the viewport ───────
function Reveal({ children, delay = 0, style = {} }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(16px)',
      transition: `opacity 0.6s ease ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      ...style,
    }}>
      {children}
    </div>
  );
}

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
        boxShadow: isPrimary ? '0 0 0 1px rgba(59,130,246,0.4), 0 8px 30px rgba(59,130,246,0.25)' : 'none',
      }}
      onMouseEnter={e => {
        if (isPrimary) { e.currentTarget.style.background = '#2563eb'; e.currentTarget.style.transform = 'translateY(-1px)'; }
        else e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={e => {
        if (isPrimary) { e.currentTarget.style.background = 'var(--blue)'; e.currentTarget.style.transform = 'translateY(0)'; }
        else e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

// ─── Ticker tape: atmospheric scrolling strip under the hero. Fake but on theme,
// it reads as a live terminal. Two copies in a row so the marquee loops seamlessly.
const TAPE = [
  ['NVDA', '+2.1%', true], ['AAPL', '-0.4%', false], ['TSLA', '+3.8%', true],
  ['MSFT', '+0.9%', true], ['AMD', '-1.2%', false], ['COST', '+0.6%', true],
  ['META', '+1.7%', true], ['SOFI', '-2.3%', false], ['PLTR', '+4.1%', true],
  ['GOOGL', '+0.3%', true], ['AMZN', '-0.8%', false], ['SPY', '+0.5%', true],
];
function TickerTape() {
  const Row = () => (
    <>
      {TAPE.map(([sym, chg, up], i) => (
        <span key={sym + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 18px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.5px' }}>{sym}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: up ? 'var(--green)' : 'var(--red)' }}>{chg}</span>
        </span>
      ))}
    </>
  );
  return (
    <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', overflow: 'hidden', background: 'rgba(255,255,255,0.012)', padding: '11px 0', whiteSpace: 'nowrap', maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}>
      <div style={{ display: 'inline-block', animation: 'lpTape 38s linear infinite' }}>
        <Row /><Row />
      </div>
    </div>
  );
}

// ─── Phone mock: a fake device frame that cycles real product cards, so the
// visitor SEES the product before reading a word of feature copy. Each card is
// rendered the way it looks inside the app (same colors, same restraint).
const MOCK_CARDS = [
  {
    tag: 'THE DAILY READ',
    render: () => (
      <div style={cardBox('rgba(59,130,246,0.08)', 'rgba(59,130,246,0.18)')}>
        <Dot color="var(--blue)" label="OUTPOST" />
        <p style={cardText}>NVDA pulled back 3% on conference noise. That is the kind of dip you said scared you, but you are still up 18% from your cost. Earnings are not until Aug 28.</p>
      </div>
    ),
  },
  {
    tag: 'THE MEMORY',
    render: () => (
      <div style={cardBox('rgba(139,92,246,0.07)', 'rgba(139,92,246,0.20)')}>
        <Dot color="var(--purple)" label="90 DAYS AGO, YOU WROTE" />
        <p style={{ ...cardText, fontStyle: 'italic', color: 'var(--muted)' }}>"Buying for the AI capex story. I exit if Q3 capex commentary softens."</p>
        <p style={{ ...cardText, marginTop: 9, fontStyle: 'normal' }}>Capex commentary has not softened. The dip is noise, not your signal.</p>
      </div>
    ),
  },
  {
    tag: 'PRE TRADE CHECK',
    render: () => (
      <div style={cardBox('rgba(245,158,11,0.07)', 'rgba(245,158,11,0.22)')}>
        <Dot color="var(--amber)" label="BEFORE YOU BUY" />
        <p style={cardText}>Adding $4,000 of AMD would put tech at 61% of your book. Last time you ran that hot you cut it in a panic. Size it half?</p>
      </div>
    ),
  },
  {
    tag: 'YOUR RECEIPTS',
    render: () => (
      <div style={cardBox('rgba(34,197,94,0.06)', 'rgba(34,197,94,0.20)')}>
        <Dot color="var(--green)" label="WHAT THE RECORD SAYS" />
        <p style={cardText}>Your buys with a written thesis win 64% of the time. Without one, 38%. The thesis is the edge, and now you can see it.</p>
      </div>
    ),
  },
];
function cardBox(bg, border) {
  return { background: `linear-gradient(180deg, ${bg}, rgba(255,255,255,0.01))`, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 15px' };
}
const cardText = { fontSize: 13, color: 'var(--text)', lineHeight: 1.6, letterSpacing: '-0.1px', margin: 0 };
function Dot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'lpDot 2s ease-in-out infinite' }} />
      <p style={{ fontSize: 9, color, letterSpacing: '1.3px', fontWeight: 700, margin: 0 }}>{label}</p>
    </div>
  );
}
function PhoneMock() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % MOCK_CARDS.length), 3400);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{
      width: 300, margin: '0 auto', borderRadius: 28, padding: 10,
      background: 'linear-gradient(180deg, #15151d, #0a0a0f)',
      border: '1px solid rgba(255,255,255,0.09)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(59,130,246,0.08)',
    }}>
      <div style={{ background: 'linear-gradient(180deg, #0c0c12, #08080c)', borderRadius: 20, padding: '16px 14px 20px', minHeight: 320 }}>
        {/* status bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, opacity: 0.5 }}>
          <span style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '1.5px', fontWeight: 700 }}>OUTPOST</span>
          <span style={{ fontSize: 8, color: 'var(--faint)' }}>9:32 AM</span>
        </div>
        {/* cycling card */}
        <div style={{ position: 'relative', minHeight: 150 }}>
          {MOCK_CARDS.map((c, i) => (
            <div key={c.tag} style={{
              position: i === idx ? 'relative' : 'absolute', inset: i === idx ? 'auto' : 0,
              opacity: i === idx ? 1 : 0,
              transform: i === idx ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.5s ease, transform 0.5s ease',
              pointerEvents: i === idx ? 'auto' : 'none',
            }}>
              {c.render()}
            </div>
          ))}
        </div>
        {/* dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 18 }}>
          {MOCK_CARDS.map((c, i) => (
            <span key={c.tag} style={{ width: i === idx ? 16 : 5, height: 5, borderRadius: 3, background: i === idx ? 'var(--blue)' : 'var(--border)', transition: 'all 0.4s ease' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Feature row: label + headline + body, with a left accent. Restrained.
function FeatureRow({ accent = 'var(--blue)', label, title, body }) {
  return (
    <div style={{ padding: '20px 22px', background: 'rgba(255,255,255,0.018)', border: '1px solid var(--border)', borderLeft: `2px solid ${accent}`, borderRadius: 10, marginBottom: 12 }}>
      <p style={{ fontSize: 9, color: accent, fontWeight: 700, letterSpacing: '1.4px', marginBottom: 7 }}>{label}</p>
      <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 7, letterSpacing: '-0.3px', lineHeight: 1.3 }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{body}</p>
    </div>
  );
}

function SectionLabel({ children, color = 'var(--faint)' }) {
  return <p style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '2px', marginBottom: 14 }}>{children}</p>;
}

export default function LandingPage({ onGetStarted, onOpenGuide }) {
  return (
    <div className="scrollable" style={{ height: '100vh', background: '#08080c', color: 'var(--text)', fontFamily: 'inherit' }}>
      <style>{`
        @keyframes lpDot { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
        @keyframes lpTape { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes lpBlink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        @keyframes lpGlow { 0%,100% { opacity: 0.5 } 50% { opacity: 0.85 } }
        .lp-link { background: none; border: none; cursor: pointer; font-family: inherit; }
      `}</style>

      {/* Top nav */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 20, background: 'rgba(8,8,12,0.82)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)' }}>OUTPOST</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onGetStarted} className="lp-link" style={{ color: 'var(--muted)', fontSize: 12, padding: 4 }}>Sign in</button>
            <PrimaryButton onClick={onGetStarted} size="sm">Get started</PrimaryButton>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        {/* glow */}
        <div style={{ position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)', width: 680, height: 420, background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.18), transparent 68%)', filter: 'blur(20px)', animation: 'lpGlow 6s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', padding: '64px 24px 40px' }}>
          <div style={wrap}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 20, padding: '5px 11px', border: '1px solid var(--border)', borderRadius: 20, background: 'rgba(255,255,255,0.02)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'lpDot 2s ease-in-out infinite' }} />
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '1.5px' }}>BUILT FOR THE RETAIL INVESTOR</span>
            </div>
            <h1 style={{ fontSize: 'clamp(38px, 8.5vw, 60px)', fontWeight: 700, lineHeight: 1.03, letterSpacing: '-1.5px', color: 'var(--text)', marginBottom: 22 }}>
              The trading partner<br/>who remembers<span style={{ color: 'var(--blue)' }}>.</span>
            </h1>
            <p style={{ fontSize: 17, color: 'var(--muted)', lineHeight: 1.55, maxWidth: 540, marginBottom: 30 }}>
              Outpost asks why you bought it. Writes down what you said. Quotes you back to yourself the next time you are about to break your own plan. No advisor does that for under $50K. No Reddit thread does it at all. ChatGPT forgets you tomorrow.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <PrimaryButton onClick={onGetStarted}>Get started, free</PrimaryButton>
              <button onClick={onOpenGuide} className="lp-link" style={{ color: 'var(--muted)', fontSize: 13, padding: 4 }}>Read the founder's guide →</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 18 }}>No credit card. The free tier covers your first portfolio.</p>
          </div>
        </div>
        <TickerTape />
      </div>

      {/* Product mock */}
      <div style={{ padding: '52px 24px 60px' }}>
        <div style={wrap}>
          <Reveal>
            <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '2px', marginBottom: 22, textAlign: 'center' }}>WHAT YOU OPEN TO</p>
            <PhoneMock />
            <p style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 22, lineHeight: 1.5, fontStyle: 'italic', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              Personal, calm, specific. Pulled from your own words and your live book. Not a feed. Not a tip. A read.
            </p>
          </Reveal>
        </div>
      </div>

      {/* The problem */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel>WHY THIS EXISTS</SectionLabel>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 18, letterSpacing: '-0.5px', lineHeight: 1.2 }}>Retail does this the hard way.</h2>
            <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 14 }}>
              You check Webull for prices. Reddit for vibes. Twitter for catalysts. ChatGPT for theory. None of them know what you actually own. None of them remember what you said you would do at your stop. None of them put the picture together for you.
            </p>
            <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 14 }}>
              Wealthy investors never deal with this. Their advisor does all of it, with full context, every day.
            </p>
            <p style={{ fontSize: 16, color: 'var(--text)', lineHeight: 1.6, fontWeight: 600 }}>Outpost is what that advisor would be. Without the 1% fee.</p>
          </Reveal>
        </div>
      </div>

      {/* Same moment, two endings */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel>SAME MOMENT, TWO ENDINGS</SectionLabel>
            <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', marginBottom: 22, letterSpacing: '-0.5px', lineHeight: 1.2 }}>The expensive habit retail has.</h2>
          </Reveal>
          <Reveal delay={80}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <div style={{ padding: '20px 18px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)', borderLeft: '2px solid var(--red)' }}>
                <p style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 8 }}>WITHOUT OUTPOST</p>
                <p style={{ color: 'var(--muted)', margin: 0 }}>NVDA drops 6%. You panic. You sell. You watch it run 22% the next month without you. The next time you buy NVDA you do not remember why you sold the last one. You make the same call again.</p>
              </div>
              <div style={{ padding: '20px 18px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.18)', borderLeft: '2px solid var(--green)' }}>
                <p style={{ fontSize: 9, color: 'var(--green)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 8 }}>WITH OUTPOST</p>
                <p style={{ color: 'var(--muted)', margin: 0 }}>NVDA drops 6%. Outpost shows you the thesis you wrote 90 days ago. "Buying for the AI capex story. Exit if Q3 capex softens." It has not softened. You hold. NVDA runs 22%. You are still in.</p>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 18, lineHeight: 1.55 }}>Outpost does not pick stocks. It makes the work you already do show up at the moment you need it most.</p>
          </Reveal>
        </div>
      </div>

      {/* What it does */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel color="var(--blue)">WHAT IT DOES</SectionLabel>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 24, letterSpacing: '-0.5px', lineHeight: 1.2 }}>One app. The five things that move the needle.</h2>
          </Reveal>
          <Reveal delay={60}>
            <FeatureRow accent="var(--purple)" label="THE MEMORY" title="It quotes your own words back to you when it counts." body="Every thesis, every reflection, every chat with the agent stays. Ask about a ticker you traded last year and Outpost reads you what you said back then. So the same lesson does not get learned twice." />
            <FeatureRow accent="var(--blue)" label="THE THESIS LOOP" title="You write why you bought it. It asks about it later." body="On the way in, why this trade. On the way out, what played out and what you learned. Over time your Patterns view shows your win rate with a thesis versus without. Most traders never see that number. Yours becomes visible." />
            <FeatureRow accent="var(--green)" label="THE DAILY READ" title="A pulse line on open. A real brief at 7:30am." body="One sentence at the top tells you what is notable in your book right now. Paid users also get a three sentence pre market brief every weekday, tuned to your style, your risk, your exact positions." />
            <FeatureRow accent="var(--cyan)" label="DEPLOY CASH" title="Got cash sitting idle. Tell it your filters." body="Aggressive or careful, income or growth, your timeframe. Outpost returns picks that fit your book, not a generic top stocks list. Hard concentration caps mean it will not push 30% of your account into one name even if you ask." />
            <FeatureRow accent="var(--amber)" label="PLAN ACCOUNTABILITY" title="You set the target and the stop. It holds you to them." body="Write what you will do at X up and Y down. When price gets there, Outpost reminds you what you said. A sharp pre trade gut check rooted in your own history asks one question before you add to a position." />
          </Reveal>
        </div>
      </div>

      {/* Honest fit */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel>HONEST FIT</SectionLabel>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 24, letterSpacing: '-0.4px', lineHeight: 1.2 }}>A tool, not a magic button.</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              <div style={{ padding: '16px 20px', background: 'rgba(34,197,94,0.04)', borderLeft: '2px solid var(--green)', borderRadius: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>YOU, IF</p>
                <ul style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                  <li>You manage your own portfolio. 5 positions or 50.</li>
                  <li>You actually research what you buy.</li>
                  <li>You have made decisions in panic that you regretted.</li>
                  <li>You want context, not stock tips.</li>
                </ul>
              </div>
              <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.04)', borderLeft: '2px solid var(--red)', borderRadius: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>NOT YOU, IF</p>
                <ul style={{ paddingLeft: 18, color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                  <li>You day trade and need execution speed.</li>
                  <li>You want signals to follow blindly.</li>
                  <li>You have never bought a stock. Open a broker first.</li>
                  <li>You want the AI to make the decision for you.</li>
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* Pricing */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel color="var(--blue)">PRICING</SectionLabel>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.5px' }}>Start free.</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>The free tier covers your first portfolio. Paid adds the morning brief, deep analysis, and unlimited reads.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>FREE</p>
                <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>$0</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>Try it. See if it fits.</p>
                <ul style={{ paddingLeft: 16, color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                  <li>Daily pulse on open</li>
                  <li>Up to 10 positions</li>
                  <li>Thesis loop and Patterns view</li>
                  <li>The agent that knows your book</li>
                  <li>Catalysts and sector heat</li>
                  <li>Trade plan tracking</li>
                </ul>
              </div>
              <div style={{ padding: 20, border: '1px solid var(--blue)', borderRadius: 10, background: 'rgba(59,130,246,0.05)', boxShadow: '0 0 40px rgba(59,130,246,0.08)' }}>
                <p style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px', marginBottom: 6 }}>PRO · COMING SOON</p>
                <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>$12<span style={{ fontSize: 14, color: 'var(--faint)', fontWeight: 400 }}>/mo</span></p>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>The full advisor experience.</p>
                <ul style={{ paddingLeft: 16, color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                  <li>Unlimited positions</li>
                  <li>Unlimited AI reads</li>
                  <li>Daily pre market brief at 7:30am</li>
                  <li>Deploy Cash recommendations</li>
                  <li>Weekly recap email</li>
                  <li>Deep analysis on any position</li>
                </ul>
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 18, lineHeight: 1.5 }}>For comparison: a real advisor charges 1% a year. On a $50K book that is $42 a month. Outpost is built for the people that math does not work for.</p>
          </Reveal>
        </div>
      </div>

      {/* Founder note */}
      <div style={{ padding: SECTION_PAD, borderTop: '1px solid var(--border)' }}>
        <div style={wrap}>
          <Reveal>
            <SectionLabel>FROM THE FOUNDER</SectionLabel>
            <p style={{ fontSize: 17, color: 'var(--text)', lineHeight: 1.6, marginBottom: 18 }}>
              "I built it because it is the tool I needed. I would spend hours pulling info on my holdings across five different apps. Nothing knew what I owned. Nothing remembered what I was thinking. So I built the version that does."
            </p>
            <button onClick={onOpenGuide} className="lp-link" style={{ color: 'var(--blue)', fontSize: 13, padding: 0, fontWeight: 600 }}>Read how I use it daily →</button>
          </Reveal>
        </div>
      </div>

      {/* Final CTA */}
      <div style={{ position: 'relative', padding: '88px 24px', borderTop: '1px solid var(--border)', textAlign: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: -140, left: '50%', transform: 'translateX(-50%)', width: 620, height: 360, background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.16), transparent 70%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
        <div style={{ ...wrap, position: 'relative' }}>
          <Reveal>
            <h2 style={{ fontSize: 'clamp(30px, 6vw, 40px)', fontWeight: 700, color: 'var(--text)', marginBottom: 12, letterSpacing: '-0.8px', lineHeight: 1.1 }}>Stop trading alone.</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 26, lineHeight: 1.5 }}>Three questions, ninety seconds. Then watch it read your first stock.</p>
            <PrimaryButton onClick={onGetStarted}>Get started, free</PrimaryButton>
          </Reveal>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: 24, borderTop: '1px solid var(--border)' }}>
        <div style={{ ...wrap, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>© Outpost. Educational tool, not financial advice.</p>
          <div style={{ display: 'flex', gap: 16 }}>
            <button onClick={onOpenGuide} className="lp-link" style={{ color: 'var(--faint)', fontSize: 11, padding: 0 }}>Founder's guide</button>
            <button onClick={onGetStarted} className="lp-link" style={{ color: 'var(--faint)', fontSize: 11, padding: 0 }}>Sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ width: 34, height: 34, borderRadius: 8, background: '#0d1117', border: '1px solid rgba(122,162,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="30" height="30" viewBox="0 0 72 72" fill="none">
        <g transform="translate(5.8,5.8) scale(0.84)" fill="none" stroke="#e8edf2" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M36 13 V8 M32 8 H40"/>
          <path d="M11 24 L24 15 H48 L61 24 Z" fill="#e8edf2"/>
          <rect x="18" y="24" width="36" height="13"/>
          <rect x="21" y="26.5" width="30" height="8" fill="#3b82f6" stroke="none"/>
          <path d="M28.5 26.5 V34.5 M36 26.5 V34.5 M43.5 26.5 V34.5" strokeWidth="1.6"/>
          <path d="M13 37 H59"/>
          <path d="M13 41 H59"/>
          <path d="M15 37 V41 M25 37 V41 M36 37 V41 M47 37 V41 M57 37 V41"/>
          <path d="M19 41 L11 63 M53 41 L61 63"/>
          <path d="M19 41 L57 52 M53 41 L15 52 M15 52 H57 M15 52 L61 63 M57 52 L11 63"/>
          <path d="M11 63 l-2 4 M61 63 l2 4"/>
        </g>
      </svg>
    </div>
  );
}
