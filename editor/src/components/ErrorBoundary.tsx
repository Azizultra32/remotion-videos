import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Error in ${this.props.name || "component"}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: 16,
            background: "#2a0000",
            border: "1px solid #ff4444",
            borderRadius: 4,
            color: "#fff",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", color: "#ff4444" }}>
            {this.props.name || "Component"} Error
          </h3>
          <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#ccc" }}>
            {this.state.error?.message || "An unknown error occurred"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "4px 12px",
              background: "#444",
              border: "1px solid #666",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
