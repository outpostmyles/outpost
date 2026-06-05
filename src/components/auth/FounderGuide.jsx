// FounderGuide. Long-form personal essay from the founder.
//
// Linked from LandingPage AND from inside Settings (so both unauth and auth
// users can read it). The point is trust: the visitor meets the actual person who
// built this and sees how he uses it, which moves the needle more than another
// feature pitch.
//
// Visual: same elevated terminal language as the landing page (scroll reveal, a
// reading progress bar, numbered sections with accent rails, pull quotes), so it
// reads premium without losing the raw founder voice.
//
// Voice: declarative, direct, self-aware, concrete tool names so the reader
// recognizes their own behavior. No em or en dashes anywhere. Content tracks the
// app as it actually is today: the agent that remembers and coaches from your own
// record, the process scoreboard, the North Star, deploy cash, the pre-trade check.

import { useState, useEffect, useRef } from 'react';

const MAX_WIDTH = 680;
const wrap = { maxWidth: MAX_WIDTH, margin: '0 auto' };

function Reveal({ children, style = {} }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(14px)',
      transition: 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.16,1,0.3,1)',
      ...style,
    }}>{children}</div>
  );
}

function Section({ n, eyebrow, heading, accent = 'var(--blue)', children }) {
  return (
    <div style={{ padding: '44px 24px', borderTop: '1px solid var(--border)' }}>
      <div style={wrap}>
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: accent, opacity: 0.6, letterSpacing: '1px', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
            <p style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: '1.6px', margin: 0 }}>{eyebrow}</p>
          </div>
          <h2 style={{ fontSize: 25, fontWeight: 700, color: 'var(--text)', marginBottom: 18, letterSpacing: '-0.5px', lineHeight: 1.22, paddingLeft: 14, borderLeft: `2px solid ${accent}` }}>{heading}</h2>
          {children}
        </Reveal>
      </div>
    </div>
  );
}

function P({ children, lead = false }) {
  return (
    <p style={{ fontSize: lead ? 17 : 15, color: lead ? 'var(--text)' : 'var(--muted)', lineHeight: 1.68, marginBottom: 14 }}>{children}</p>
  );
}

// A big punchy callout between sections. Italic, accent rule, faint glow.
function Pull({ children }) {
  return (
    <div style={{ padding: '36px 24px', borderTop: '1px solid var(--border)', background: 'rgba(59,130,246,0.02)' }}>
      <div style={wrap}>
        <Reveal>
          <p style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, letterSpacing: '-0.5px', fontStyle: 'italic', paddingLeft: 16, borderLeft: '3px solid var(--blue)' }}>
            {children}
          </p>
        </Reveal>
      </div>
    </div>
  );
}

export default function FounderGuide({ onBack, onGetStarted }) {
  const scrollRef = useRef(null);
  const [progress, setProgress] = useState(0);

  function onScroll(e) {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="scrollable" style={{ height: '100vh', background: '#08080c', color: 'var(--text)', fontFamily: 'inherit' }}>
      {/* Reading progress */}
      <div style={{ position: 'sticky', top: 0, left: 0, height: 2, zIndex: 30 }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--blue)', boxShadow: '0 0 8px rgba(59,130,246,0.6)', transition: 'width 0.1s linear' }} />
      </div>

      {/* Top bar */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '12px 24px', position: 'sticky', top: 2, background: 'rgba(8,8,12,0.82)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 20 }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 4 }}>← Back</button>
          {onGetStarted && (
            <button onClick={onGetStarted} style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 0 1px rgba(59,130,246,0.4), 0 6px 20px rgba(59,130,246,0.22)' }}>Get started</button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)', width: 560, height: 360, background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.16), transparent 68%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', padding: '66px 24px 40px' }}>
          <div style={wrap}>
            <p style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, letterSpacing: '2px', marginBottom: 16 }}>FOUNDER'S GUIDE</p>
            <h1 style={{ fontSize: 'clamp(33px, 6.5vw, 46px)', fontWeight: 700, lineHeight: 1.08, letterSpacing: '-1px', color: 'var(--text)', marginBottom: 18 }}>
              How I actually use Outpost.
            </h1>
            <p style={{ fontSize: 14, color: 'var(--faint)', lineHeight: 1.6 }}>By Myles. Founder, Outpost. A real read on the thing I built, and the trades it has talked me out of.</p>
          </div>
        </div>
      </div>

      <Section n="01" eyebrow="WHY I BUILT IT" heading="It's the tool I needed." accent="var(--blue)">
        <P lead>
          There is one trade in every retail trader's history they wish they had not made. Not the bad pick. The bad reaction. Sold on a 6% dip because the group chat was panicking. Held something broken because admitting it was hard. Bought a top because the narrative was loud and they never wrote down what would change their mind.
        </P>
        <P>I have made all three. Outpost is the partner I built so I make fewer of them.</P>
        <P>
          I trade my own book. 20 to 40 positions at any given time. Long term holds, ETFs, the kind of portfolio retail investors actually run. I was doing the research the hard way. Webull for prices. Reddit for vibes. Twitter for catalysts. ChatGPT when I wanted a second opinion. None of them knew what I owned. Every time I wanted to talk through a position I had to re-explain my whole situation from scratch. And the next day, none of them remembered.
        </P>
        <P>
          The wealthy do not have this problem. They have an advisor. Someone who knows the full picture, calms them when it gets scary, points out what they missed. That help costs 1% of your portfolio a year. On a smaller book the math does not work.
        </P>
        <P>Outpost is the version of that help that does work. Built for the little guy. Built by someone running the same kind of book and making the same mistakes.</P>
      </Section>

      <Pull>It does not pick stocks for you. It makes the work you already do show up at the exact moment you are about to ignore it.</Pull>

      <Section n="02" eyebrow="THE FIRST 90 SECONDS" heading="It asks who I am before it says a word." accent="var(--purple)">
        <P>
          The first thing Outpost does is ask three questions. What got you into this. A stock you wish you had bought and what stopped you. What scares you most right now. Real questions, not form fields.
        </P>
        <P>
          I answered them honestly, and the thing is, it kept them. Months later it still quotes my own answer back to me when I am about to do the exact thing I said I was afraid of. That is the whole bet. What you tell it now, it remembers forever. Nothing else in my stack does that.
        </P>
      </Section>

      <Section n="03" eyebrow="MY MORNING" heading="Five minutes before the open." accent="var(--green)">
        <P>
          I open Outpost around 9:00 AM ET. The Home tab loads with one pulse line at the very top, a single sentence on what is actually notable in my book right now. On quiet days it tells me it is quiet, which is its own kind of useful.
        </P>
        <P>
          Then the brief. Three sentences tuned to my positions, my style, my risk. The regime, what it means for the way I trade, one thing to watch. Some mornings it flags a position I forgot was reporting. Some mornings it tells me today is noise and to sit still.
        </P>
        <P>
          When I want structure I run the Daily Round. It walks me through the few things that actually need me today, a position to reflect on, a plan to set, a question to ask, and nothing else. It is the opposite of a feed. It ends. Then I close the app and go about my day.
        </P>
      </Section>

      <Section n="04" eyebrow="WHEN A POSITION DROPS" heading="The 'oh no' moment, defused." accent="var(--red)">
        <P>
          A stock is down 6% intraday. Old me stared at it for an hour, scrolled for doomers, found three, and panic sold by lunch on what was probably nothing.
        </P>
        <P>
          New flow: open Outpost, tap the position, get the read. Thirty seconds later I have something calm. Sometimes it says the move tracks the index and my thesis has not changed. Sometimes it says earnings missed on the exact margin line I was worried about, and that is a real change. Either way I am grounded. I sit on my hands or I make a deliberate call. No panic.
        </P>
        <P>
          The voice is the product. I spent weeks tuning it to sound like a friend who has seen a few cycles. Not a hype account screaming about momentum. Not a doomer telling me to sell everything. That line is the whole thing.
        </P>
      </Section>

      <Section n="05" eyebrow="THE PLAN, AND BEING HELD TO IT" heading="The part that saves me the most money." accent="var(--amber)">
        <P>
          Every position I hold has a plan. Why I bought it. Where I would take profit. Where I would cut. I write it before I am in the trade emotionally, while I can still see straight.
        </P>
        <P>
          When price hits one of those levels, Outpost tells me. Not "buy" or "sell." Just "you are at your stop, here is what you said you would do, decide on purpose." And before I add to anything, the pre-trade check asks one sharp question rooted in my own history. It will say something like, this would put tech at 61% of your book, and the last time you ran that hot you cut it in a panic. Size it half?
        </P>
        <P>
          The most expensive habit in retail is writing a plan and abandoning it the second it gets uncomfortable. Outpost is the friend that does not let me get away with it.
        </P>
      </Section>

      <Pull>The agent does not just answer me. It remembers me, and it coaches from my own record, not from generic finance advice.</Pull>

      <Section n="06" eyebrow="THE PART THAT REMEMBERS ME" heading="A partner, not a chatbot." accent="var(--purple)">
        <P>
          The Agent tab is where the real conversations happen. It knows my positions, my plans, and everything I have told it. I can ask "what is my biggest risk right now" or "is my AAPL thesis still holding up after today" and get an answer grounded in my actual data.
        </P>
        <P>
          Two things make it different from every other AI I have used. First, it reads my own words back to me. Ask about a name I traded last year and it pulls up the thesis I wrote and the reflection I logged when I closed it, in my voice, with the date. Second, it coaches from my real patterns. It has watched me trade, so it can say "you are genuinely good at patient adds in quality names, and you give it back chasing green days, here is the number."
        </P>
        <P>
          And when it suggests an actual move, setting a stop, or even sizing a buy, it never just does it. It drafts a card and waits for me to tap Apply. Nothing changes to my account unless I am the one who commits it. That rule is not negotiable.
        </P>
      </Section>

      <Section n="07" eyebrow="THE SCOREBOARD NO BROKER SHOWS" heading="Am I actually getting better." accent="var(--cyan)">
        <P>
          Most apps show you profit and loss. P and L is mostly luck in the short run, so it is the wrong scoreboard. Outpost grades me on process: did I have a reason, did I size it sanely, did I avoid chasing. A lucky win with no thesis does not score well, on purpose.
        </P>
        <P>
          The Patterns view is where this lands. It shows my win rate with a written thesis versus without one. The gap is bigger than I wanted to admit, and seeing it changed how I trade. It also names my recurring mistakes with a real stat behind each one, not vibes. Holding losers longer than winners. Betting too big. Buying names already up double digits on the day.
        </P>
        <P>That is the screen no broker will ever show you, because no broker is on your side that way.</P>
      </Section>

      <Section n="08" eyebrow="THE NUMBER I TRADE TOWARD" heading="A North Star, not a vibe." accent="var(--green)">
        <P>
          I set a real goal in the app. The number that would actually change my life, and when I want to reach it. Outpost holds it in front of me and gives me an honest read on whether my current trajectory gets there, not a fantasy projection.
        </P>
        <P>
          It is the difference between trading to feel busy and trading toward something. When the goal is concrete, the dumb impulsive trades get easier to skip, because I can see what they cost the thing I actually want.
        </P>
      </Section>

      <Section n="09" eyebrow="FINDING THE NEXT ONE" heading="Cash off the bench, and where I look." accent="var(--cyan)">
        <P>
          When I have cash sitting idle, I use Deploy Cash. I tell it aggressive or careful, income or growth, my timeframe, and it returns a few picks that fit my actual book, not a generic top stocks list. There are hard concentration caps baked in, so it will not push 30% of my account into one name even when I ask for aggressive.
        </P>
        <P>
          For discovery I lean on three things. Bargain Radar surfaces oversold names where the story has not actually broken. Sector Radar shows where money is rotating, good context even though I do not trade rotations directly. Catalyst Watch drops a few times a day with real reasons attached. I treat all of it like a tip from a research desk, not a buy signal. Often I read it and do nothing. The value is not having to go scrape it off Twitter myself.
        </P>
      </Section>

      <Section n="10" eyebrow="HONESTLY" heading="What this is not." accent="var(--red)">
        <P>Outpost will not pick stocks for you. That is not what an advisor does, and it is not what this is. If you want tips to follow blindly, wrong product.</P>
        <P>
          It also will not fix an undisciplined trader. The tools only work if you actually write the plan, actually read the brief, actually pause when it tells you to. The product is the prompt. You are still the one making the call.
        </P>
        <P>And it is not for day traders. The whole voice is built for swing and long term holders. If you need speed and execution, this is not your tool.</P>
      </Section>

      <Section n="11" eyebrow="WHERE THIS IS GOING" heading="It compounds." accent="var(--blue)">
        <P>
          The thing that makes Outpost better over time is not the feature list. It is the loop. Every read is graded, every signal gets folded into the next version, and the more honest history you give it, the sharper its read on you gets. The version six months from now is meaningfully better than today's because it learned, from real use.
        </P>
        <P>That is the same thing that made the good AI products good. Fast iteration on real conversations. Most apps ship a feature and forget. Outpost is built around the loop.</P>
      </Section>

      {/* Final */}
      <div style={{ position: 'relative', padding: '80px 24px', borderTop: '1px solid var(--border)', textAlign: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: -130, left: '50%', transform: 'translateX(-50%)', width: 560, height: 320, background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.16), transparent 70%)', filter: 'blur(20px)', pointerEvents: 'none' }} />
        <div style={{ ...wrap, position: 'relative' }}>
          <Reveal>
            <h2 style={{ fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 700, color: 'var(--text)', marginBottom: 14, letterSpacing: '-0.6px', lineHeight: 1.15 }}>That is how I use it.</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>If any of this sounds like what you have been missing, the free tier covers your first portfolio. No card needed.</p>
            {onGetStarted && (
              <button onClick={onGetStarted} style={{ background: 'var(--blue)', color: '#fff', border: 'none', padding: '14px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 0 0 1px rgba(59,130,246,0.4), 0 8px 30px rgba(59,130,246,0.25)' }}>Get started, free</button>
            )}
            <p style={{ fontSize: 11, color: 'var(--faint)', marginTop: 24 }}>Built by Myles. Educational tool, not financial advice.</p>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
