// Install Prompt — surfaces an "Install Outpost" banner when the app is
// installable. Two paths:
//   1. Chromium / Android — uses the `beforeinstallprompt` event fired by the
//      browser. Tap the button → native install dialog.
//   2. iOS Safari — no programmatic install API. We show a hint that points
//      users at Share → Add to Home Screen (with a tiny visual cue).
//
// Auto-hides when:
//   - app is already running standalone (display-mode: standalone or iOS standalone flag)
//   - user dismissed within the last 30 days (localStorage timestamp)
//   - user is on a desktop browser that doesn't support PWA install (no event fired)
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'outpost_install_dismissed_at';
const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  // PWA installed: display-mode media query
  if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  // iOS standalone flag (legacy but still used by Safari)
  if (window.navigator?.standalone === true) return true;
  return false;
}

function isIOSDevice() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  // iPad on iOS 13+ identifies as Mac — also check touch points
  const isIPad = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIPad;
}

function isRecentlyDismissed() {
  try {
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (!ts) return false;
    return Date.now() - ts < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);  // saved BeforeInstallPromptEvent
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandaloneMode() || isRecentlyDismissed()) return;

    // Chromium path
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS Safari has no event — show hint after a beat so users can settle in first
    if (isIOSDevice()) {
      const t = setTimeout(() => setShowIOSHint(true), 8000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      };
    }

    // Hide once installed (Chromium fires this when user accepts)
    const onInstalled = () => {
      setInstallEvent(null);
      setShowIOSHint(false);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  }

  async function handleInstall() {
    if (!installEvent) return;
    try {
      installEvent.prompt();
      const choice = await installEvent.userChoice;
      // Whether accepted or dismissed, we won't re-prompt — the event is consumed.
      if (choice.outcome === 'dismissed') dismiss();
      setInstallEvent(null);
    } catch {
      setInstallEvent(null);
    }
  }

  if (dismissed) return null;
  if (!installEvent && !showIOSHint) return null;

  // iOS hint — non-actionable, just instructions
  if (showIOSHint && !installEvent) {
    return (
      <div style={bannerStyle}>
        <div style={contentStyle}>
          <p style={titleStyle}>Install Outpost</p>
          <p style={bodyStyle}>
            Tap <span style={shareIconStyle}>⎙</span> Share, then "Add to Home Screen".
          </p>
        </div>
        <button onClick={dismiss} style={dismissButtonStyle} aria-label="Dismiss">×</button>
      </div>
    );
  }

  // Chromium / Android — actionable install button
  return (
    <div style={bannerStyle}>
      <div style={contentStyle}>
        <p style={titleStyle}>Install Outpost</p>
        <p style={bodyStyle}>Faster access, no browser tabs. Free, takes 5 seconds.</p>
      </div>
      <button onClick={handleInstall} style={installButtonStyle}>INSTALL</button>
      <button onClick={dismiss} style={dismissButtonStyle} aria-label="Dismiss">×</button>
    </div>
  );
}

// ---------- styles (inline to match the rest of the codebase) ----------

const bannerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  margin: '6px 16px 0',
  background: 'rgba(59,130,246,0.08)',
  border: '1px solid rgba(59,130,246,0.25)',
  borderRadius: 8,
  flexShrink: 0,
};

const contentStyle = {
  flex: 1,
  minWidth: 0,
};

const titleStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--blue)',
  letterSpacing: '0.5px',
  marginBottom: 2,
};

const bodyStyle = {
  fontSize: 10,
  color: 'var(--muted)',
  lineHeight: 1.4,
};

const shareIconStyle = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--blue)',
  margin: '0 1px',
  transform: 'translateY(1px)',
};

const installButtonStyle = {
  background: 'var(--blue)',
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 5,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

const dismissButtonStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--faint)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '4px 6px',
  fontFamily: 'inherit',
  flexShrink: 0,
};
