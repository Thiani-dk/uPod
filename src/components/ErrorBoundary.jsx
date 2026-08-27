// src/components/ErrorBoundary.jsx
// Wraps Shell (the screen UI), not PlayerProvider — a render crash in one
// screen shouldn't tear down the <audio> element, AudioEngine, or
// MediaSession/lock-screen controls, all of which live in PlayerProvider
// above this boundary. Playback can keep running behind a crashed screen.
import React from "react";
import { RefreshCw } from "lucide-react";
import NoteMark from "./NoteMark";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render error caught by ErrorBoundary:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 32,
          textAlign: "center",
        }}
      >
        <NoteMark size={40} style={{ color: "var(--accent)", opacity: 0.7 }} />
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
        <div className="settings-row-sub" style={{ maxWidth: 320 }}>
          This screen hit an error and couldn't display.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="ghost-btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="primary-btn" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Reload app
          </button>
        </div>
      </div>
    );
  }
}
