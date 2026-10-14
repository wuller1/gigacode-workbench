import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sanitizeUiDiagnostic } from "./ToolBoundary";
import "./styles.css";
import "@xterm/xterm/css/xterm.css";

createRoot(document.getElementById("root")!, {
  // Preserve caught-error telemetry without React's unbounded raw Error dump.
  onCaughtError(error, info) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "Caught renderer failure",
      sanitizeUiDiagnostic(message, 2000),
      sanitizeUiDiagnostic(info.componentStack || "", 2000),
    );
  },
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
