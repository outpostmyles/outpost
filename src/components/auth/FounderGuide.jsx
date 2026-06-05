// FounderGuide. Long-form personal essay from the founder.
// Linked from LandingPage AND from inside Settings (so both unauth and auth
// users can read it). The point is trust. The visitor sees the actual person
// who built this and how they personally use it. That moves the needle more
// than another feature pitch.
//
// Voice notes: declarative, direct, no em-dashes, occasional self-aware lines,
// concrete tool names (Webull, Reddit, ChatGPT) so the user recognizes their
// own behavior. Less polished than corporate copy. More like a real founder
// talking to a friend.

const SECTION_PAD = '40px 24px';
const MAX_WIDTH = 680;
const wrap = { maxWidth: MAX_WIDTH, margin: '0 auto' };

function Section({ eyebrow, heading, children }) {
  return (
    <div style={{ padding: SECTION_PAD, borderBottom: '1px solid var(--border)' }}>
      <div style={wrap}>
        {eyebrow && (
          <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.5px', marginBottom: 12 }}>{eyebrow}</p>
        )}
        {heading && (
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 16, letterSpacing: '-0.4px', lineHeight: 1.25 }}>{heading}</h2>
        )}
        {children}
      </div>
    </div>
  );
}

function P({ children, lead = false }) {
  return (
    <p style={{
      fontSize: lead ? 17 : 15,
      color: lead ? 'var(--text)' : 'var(--muted)',
      lineHeight: 1.65,
      marginBottom: 14,
    }}>{children}</p>
  );
}

export default function FounderGuide({ onBack, onGetStarted }) {
  return (
    <div style={{
      height: '100vh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      background: '#08080c',
      color: 'var(--text)',
      fontFamily: 'inherit',
    }}>

      {/* Top bar */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 24px', position: 'sticky', top: 0, background: '#08080c', zIndex: 10 }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 4 }}
          >
            ← Back
          </button>
          {onGetStarted && (
            <button
              onClick={onGetStarted}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Get started
            </button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div style={{ padding: '64px 24px 32px' }}>
        <div style={wrap}>
          <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '2px', marginBottom: 16 }}>
            FOUNDER'S GUIDE
          </p>
          <h1 style={{
            fontSize: 'clamp(32px, 6vw, 44px)',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.8px',
            color: 'var(--text)',
            marginBottom: 18,
          }}>
            How I actually use Outpost.
          </h1>
          <p style={{ fontSize: 14, color: 'var(--faint)', lineHeight: 1.6 }}>
            By Myles. Founder, Outpost.
          </p>
        </div>
      </div>

      {/* Why I built it */}
      <Section eyebrow="WHY I BUILT IT" heading="It's the tool I needed.">
        <P lead>
          There's one trade in every retail trader's history they wish they hadn't made. Not the bad pick. The bad reaction. Sold on a 6% dip because the group chat was panicking. Held something broken because admitting it was hard. Bought a top because the narrative was loud and they never wrote down what would change their mind.
        </P>
        <P>
          I've made all three. Outpost is the partner I built so I make fewer of them.
        </P>
        <P>
          I trade my own portfolio. 20 to 40 positions at any given time. Long-term holds, ETFs, the kind of book retail investors actually run. I was doing the research the hard way. Webull for prices. Reddit for vibes. Twitter for catalysts. ChatGPT when I wanted a second opinion. None of them knew what I actually owned. Every time I wanted to talk through a position I had to re-explain my whole situation from scratch. And the next day, none of them remembered.
        </P>
        <P>
          The wealthy don't have this problem. They have advisors. Someone who knows the full picture. Calms them when things get scary. Points out the stuff they missed. That kind of help costs 1% of your portfolio per year. On a smaller book the math doesn't work.
        </P>
        <P>
          Outpost is the version of that help that does work. Built for the little guy. Built by someone running the same kind of book, and making the same mistakes.
        </P>
      </Section>

      {/* Morning routine */}
      <Section eyebrow="MY MORNING" heading="What I do every weekday before market open.">
        <P>
          I open Outpost around 9:00 AM ET. Home tab loads. TODAY is at the top. Usually one or two cards. A sector heating up. A position of mine moving. A catalyst worth knowing. On quiet days it just tells me it's quiet, which is also useful.
        </P>
        <P>
          Then I read my brief. Three sentences, tailored to my book. The market regime, what it means for the way I trade, one specific thing to watch. Some days it flags a position I forgot was reporting earnings. Some days it tells me today is noise and to stay calm. I trust the brief because I built it to be honest, not loud.
        </P>
        <P>
          Five minutes. Then I close the app and go about my day.
        </P>
      </Section>

      {/* When something drops */}
      <Section eyebrow="WHEN A POSITION DROPS" heading="The 'oh no' moment, defused.">
        <P>
          Stock down 6% intraday. Old me stared at it for an hour. Scrolled Twitter. Found three doomers. Panic-sold by lunch. Lost money on what was probably nothing.
        </P>
        <P>
          New flow: open Outpost, tap the position, hit Get AI Read. 30 seconds later I have a calm read. Sometimes it says: today's move tracks the broader index, your thesis hasn't changed. Sometimes it says: earnings missed materially, the thesis you wrote about margins is broken, that's a real change. Either way I'm grounded. I sit on my hands or I make a deliberate decision. No panic.
        </P>
        <P>
          The voice matters. I spent weeks tuning it to sound like a friend who's seen many cycles. Not a hype trader yelling about momentum. Not a doomer telling me to sell everything. That distinction is the whole product.
        </P>
      </Section>

      {/* Trade plans */}
      <Section eyebrow="TRADE PLANS" heading="The feature I use the most.">
        <P>
          Every position I hold has a trade plan. Entry thesis (why I bought it). Price target (where I'd take profit). Stop loss (where I'd cut). I write these BEFORE I'm in the trade emotionally. When I'm calm. When I can see clearly.
        </P>
        <P>
          When the price hits one of those levels, Outpost tells me. Not "BUY!" or "SELL!" Just "you're at your stop, what you said you'd do is X, decide intentionally."
        </P>
        <P>
          The most expensive mistake retail investors make is writing a plan and then ignoring it the moment it gets uncomfortable. Outpost is the friend that won't let me get away with it.
        </P>
      </Section>

      {/* Discovery */}
      <Section eyebrow="DISCOVERY" heading="How I find new stocks.">
        <P>
          Three places in the app. Bargain Radar, Sector Radar, and Catalyst Watch.
        </P>
        <P>
          Bargain Radar surfaces oversold stocks where the fundamentals haven't actually changed. Down 30% on macro fear, story still works. I check this maybe once a week.
        </P>
        <P>
          Sector Radar shows where money is rotating. If tech is heating up, the app tells me. I don't trade rotations directly but it's good context for the picks I'm considering.
        </P>
        <P>
          Catalyst Watch drops three times a day. Premarket, midday, power hour. Each drop has three stocks with real reasons (earnings, news, analyst action) and a strength rating. I treat it like a tip from a research analyst, not a buy signal. Sometimes it surfaces a stock I already hold and didn't realize had news. Sometimes I add to my watchlist. Often I read it and do nothing. The value is not having to scroll Twitter to find it.
        </P>
      </Section>

      {/* Journal */}
      <Section eyebrow="THE JOURNAL" heading="Where I save what I don't want to forget.">
        <P>
          The Journal tab is my private scratchpad. AI reads worth saving. Ideas I had. Things I want to revisit. It's NOT fed to the agent. What I write there is for me, not for the bot. Think of it as a notebook.
        </P>
        <P>
          What IS fed to the agent: my trade plans, my entry thesis, my exit reflections. Those are structured fields tied to specific positions. Anything I want to be private stays in the journal.
        </P>
      </Section>

      {/* Agent */}
      <Section eyebrow="THE AGENT" heading="When I have an actual question.">
        <P>
          The Agent tab is where I have real conversations. It knows my positions, my plans, what I've asked before. I can say things like "what's my biggest risk right now" or "is my AAPL thesis still holding up given today's news" and get a real answer grounded in my actual data. Not generic finance-bot output.
        </P>
        <P>
          I use it less than the AI Reads on positions, but when I use it, it's the most powerful tool in the app.
        </P>
      </Section>

      {/* Honest about limits */}
      <Section eyebrow="HONESTLY" heading="What this app is not.">
        <P>
          Outpost won't pick stocks for you. That's not what advisors do, and it's not what this is. If you want stock tips, this is the wrong product.
        </P>
        <P>
          It also won't make you a better investor if you're undisciplined. The tools are useful only if you actually write trade plans. Actually read your brief. Actually pause when it tells you to. The product is the prompt. You're still the one making the call.
        </P>
        <P>
          And it's not a fit if you day-trade. The voice is calibrated for swing and long-term holders. Day traders need speed and execution tools. Not a calm friend.
        </P>
      </Section>

      {/* The compounding loop */}
      <Section eyebrow="WHERE THIS IS GOING" heading="The compounding part.">
        <P>
          The thing that makes Outpost get better over time isn't features. It's the feedback loop. Every AI response is graded. Every user signal feeds back into the next iteration. The version six months from now will be meaningfully better than today's because it learned from real users. You.
        </P>
        <P>
          This is the same thing that made Claude and ChatGPT good. Fast iteration on real conversations. Most apps don't do this. Most apps ship features and forget. Outpost is built around the loop.
        </P>
      </Section>

      {/* Final */}
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <div style={wrap}>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 14, letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            That's how I use it.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>
            If any of this sounds like what you've been missing, the free tier covers your first portfolio. No card needed.
          </p>
          {onGetStarted && (
            <button
              onClick={onGetStarted}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                padding: '14px 28px', borderRadius: 8,
                fontSize: 14, fontWeight: 700, letterSpacing: '0.5px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Get started, free
            </button>
          )}
          <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 24 }}>
            Built by Myles. Educational tool, not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
