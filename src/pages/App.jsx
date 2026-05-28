import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthScreen from '../components/auth/AuthScreen.jsx';
import OnboardingScreen from '../components/auth/OnboardingScreen.jsx'; // kept for fallback / reference — no longer routed
import ConversationalOnboarding from '../components/auth/ConversationalOnboarding.jsx';
import LandingPage from '../components/auth/LandingPage.jsx';
import FounderGuide from '../components/auth/FounderGuide.jsx';
import ResetPasswordScreen from '../components/auth/ResetPasswordScreen.jsx';
import AppShell from '../components/shared/AppShell.jsx';

// Read ?token=... once at module load. Reset-password emails link here.
const initialResetToken = (() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return window.location.pathname === '/reset-password' ? params.get('token') : null;
})();

export default function App() {
  const { user, loading } = useAuth();
  const [resetToken, setResetToken] = useState(initialResetToken);
  // Unauth users land on the marketing page first. They navigate to:
  //   'landing' (default) → LandingPage
  //   'guide'             → FounderGuide
  //   'auth'              → AuthScreen (sign in / sign up)
  // Once authenticated this state is ignored.
  const [unauthScreen, setUnauthScreen] = useState('landing');

  function clearResetToken() {
    setResetToken(null);
    window.history.replaceState({}, '', '/');
    setUnauthScreen('auth');
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#08080c' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 72 72" fill="none">
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
          <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #3b82f6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (resetToken && !user) {
    return <ResetPasswordScreen token={resetToken} onDone={clearResetToken} />;
  }

  if (!user) {
    if (unauthScreen === 'auth') {
      return <AuthScreen />;
    }
    if (unauthScreen === 'guide') {
      return (
        <FounderGuide
          onBack={() => setUnauthScreen('landing')}
          onGetStarted={() => setUnauthScreen('auth')}
        />
      );
    }
    return (
      <LandingPage
        onGetStarted={() => setUnauthScreen('auth')}
        onOpenGuide={() => setUnauthScreen('guide')}
      />
    );
  }
  if (!user.onboarding_complete) return <ConversationalOnboarding />;
  return <AppShell />;
}
