import { Component, type ErrorInfo, type ReactNode } from "react";

type AppCrashBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type AppCrashBoundaryState = {
  error: Error | null;
};

export default class AppCrashBoundary extends Component<AppCrashBoundaryProps, AppCrashBoundaryState> {
  state: AppCrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppCrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tigrana stopped rendering", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app-crash-screen" role="alert">
        <section className="app-crash-panel">
          <h1>Tigrana ran into an error</h1>
          <p>This window stopped rendering. Reload it to reopen your notebook.</p>
          <button type="button" onClick={this.props.onReload ?? (() => window.location.reload())}>
            Reload Tigrana
          </button>
          <details>
            <summary>Error details</summary>
            <pre>{error.stack || `${error.name}: ${error.message}`}</pre>
          </details>
        </section>
      </main>
    );
  }
}
