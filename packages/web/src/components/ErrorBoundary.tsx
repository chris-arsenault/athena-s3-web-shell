import { Component, type ErrorInfo, type ReactNode } from "react";

import "./ErrorBoundary.css";

interface State {
  error: Error | null;
}

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boundary-wrap">
          <div className="boundary reg">
            <div className="boundary-head tracked">
              <span className="tok tok-danger">system halt</span>
              <span className="boundary-rule" aria-hidden />
              <span className="mono">console · 0x01</span>
            </div>
            <h2 className="boundary-title serif">The console stalled.</h2>
            <p className="boundary-sub mono text-muted">
              An unhandled exception surfaced to the root boundary.
              Reload the page; if it persists, check the browser console.
            </p>
            <pre className="boundary-stack mono">{this.state.error.message}</pre>
            <div className="boundary-foot tracked">
              <span>reload recommended</span>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
