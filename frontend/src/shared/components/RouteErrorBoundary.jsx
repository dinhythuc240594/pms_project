import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import LohaErrorPage from './LohaErrorPage';
import { useDraftNavigation } from '../drafts/DraftGuardProvider';
import { attemptChunkReload, isRouteChunkLoadError, reloadCurrentRoute } from '../lib/chunkRecovery.js';
import { useI18n } from '../i18n/useI18n.js';

class ViewErrorBoundary extends Component {
  state = { failed: false, error: null, route: this.props.route };
  static getDerivedStateFromProps({ route }, state) {
    return route === state.route ? null : { failed: false, error: null, route };
  }
  static getDerivedStateFromError(error) { return { failed: true, error }; }
  componentDidCatch(error) {
    attemptChunkReload(error);
  }
  render() {
    const { error } = this.state;
    if (!this.state.failed) return this.props.children;
    const chunkFailure = isRouteChunkLoadError(error);
    const retry = chunkFailure
      ? () => this.props.navigation.requestLeave(reloadCurrentRoute)
      : () => this.setState({ failed: false, error: null });
    return <LohaErrorPage status={chunkFailure ? 503 : 500} fullPage={this.props.fullPage} message={chunkFailure ? this.props.chunkMessage : undefined} onRetry={retry} />;
  }
}

export default function RouteErrorBoundary({ children, fullPage = true }) {
  const { pathname, search, hash } = useLocation();
  const navigation = useDraftNavigation();
  const { t } = useI18n();
  return <ViewErrorBoundary route={pathname + search + hash} navigation={navigation} fullPage={fullPage} chunkMessage={t('routes.chunkFailed')}>{children}</ViewErrorBoundary>;
}
