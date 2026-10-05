import { Component, createElement as h } from 'react';

/**
 * Catches render errors so one broken component cannot blank the whole screen.
 * `autoReloadMs` (used by the LED) reloads the page after a crash, so an unattended display
 * recovers by itself.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('UI error', error); // eslint-disable-line no-console
    if (this.props.autoReloadMs) setTimeout(() => window.location.reload(), this.props.autoReloadMs);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return h('div', { style: { padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' } },
      h('p', { style: { fontWeight: 600 } }, 'Something went wrong on this screen.'),
      h('button', {
        type: 'button',
        onClick: () => window.location.reload(),
        style: { marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' },
      }, 'Reload'));
  }
}
