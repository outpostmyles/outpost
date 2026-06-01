import React from 'react';

/**
 * Catches rendering errors anywhere in the component tree and shows a fallback.
 * Without this, one broken component white-screens the whole app.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Two shapes. The root boundary fills the screen: the whole app is down, so
    // reloading is the move. An inline boundary sits inside a single tab, so one
    // broken view degrades locally while the nav and the other tabs keep
    // working, and "try again" re-renders just this section.
    const inline = this.props.variant === 'inline';
    const wrapStyle = inline
      ? { padding: '56px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
      : { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg, #0a0a0a)' };
    const heading = inline ? 'This view hit a snag' : 'Something went wrong';
    const body = inline
      ? 'This section ran into an error. Your data is safe. Try again, or switch tabs and come back.'
      : 'The app ran into an unexpected error. Your data is safe, just reload to get back on track.';

    return (
      <div style={wrapStyle}>
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠</div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text, #fff)', marginBottom: 10, letterSpacing: '0.3px' }}>
            {heading}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--muted, #888)', lineHeight: 1.6, marginBottom: 24 }}>
            {body}
          </p>
          {this.state.error?.message && (
            <details style={{ marginBottom: 20, textAlign: 'left', fontSize: 10, color: 'var(--faint, #555)' }}>
              <summary style={{ cursor: 'pointer', padding: '6px 0', letterSpacing: '0.5px' }}>ERROR DETAILS</summary>
              <pre style={{ padding: 10, background: 'var(--surface, #111)', border: '1px solid var(--border, #222)', borderRadius: 6, overflow: 'auto', marginTop: 6, fontSize: 10 }}>
                {String(this.state.error.message).slice(0, 300)}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={this.handleReset}
              className={inline ? 'btn btn-blue' : 'btn btn-muted'}
              style={{ flex: 1, padding: 12, fontSize: 11 }}
            >
              TRY AGAIN
            </button>
            <button
              onClick={this.handleReload}
              className={inline ? 'btn btn-muted' : 'btn btn-blue'}
              style={{ flex: 1, padding: 12, fontSize: 11 }}
            >
              {inline ? 'RELOAD' : 'RELOAD APP'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
