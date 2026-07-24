import React from "react";
import { createRoot } from "react-dom/client";
import Layer from "./Layer.jsx";
import "./index.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Layer failed to render:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
            background: "#eef3f8",
            color: "#142236",
          }}
        >
          <section
            style={{
              width: "min(480px, 100%)",
              padding: "28px",
              borderRadius: "24px",
              background: "white",
              boxShadow: "0 20px 60px rgba(20, 34, 54, 0.12)",
            }}
          >
            <h1 style={{ marginTop: 0 }}>Layer could not load</h1>
            <p>Please refresh the page. If the problem continues, clear this site’s stored data and try again.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 0,
                borderRadius: "14px",
                padding: "12px 16px",
                background: "#142236",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload Layer
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("The #root element is missing from index.html.");
}

createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Layer />
    </AppErrorBoundary>
  </React.StrictMode>
);
