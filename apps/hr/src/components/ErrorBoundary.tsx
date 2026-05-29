import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureReactError } from '@open-resource/shared'

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureReactError({
      message: error.message,
      error_stack: error.stack,
      component_stack: info.componentStack ?? undefined,
      route: window.location.pathname,
      timestamp: new Date().toISOString(),
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-base)',
          gap: 16,
        }}>
          <h2 style={{ color: 'var(--text-primary)', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0, textAlign: 'center', maxWidth: 420 }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn btn-primary"
            style={{ marginTop: 8 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
