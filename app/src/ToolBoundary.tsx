import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

type Props = { title: string; children: ReactNode };
type State = { failed: boolean; attempt: number };
export function sanitizeUiDiagnostic(value: string, maximum: number): string {
  return value
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1[redacted]")
    .replace(
      /(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s<]+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:password|access_token|refresh_token|api[_-]?key|secret)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?[redacted]")
    .slice(0, maximum);
}

/** Isolate a tool's render/lifecycle failure. Retrying remounts only its children;
 * the workspace, other tools, session runtimes and their drafts keep their owners. */
export class ToolBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      "[tool-panel-failed] " +
        JSON.stringify({
          panel: sanitizeUiDiagnostic(this.props.title, 120),
          name: sanitizeUiDiagnostic(
            error instanceof Error ? error.name : "Error",
            80,
          ),
          message: sanitizeUiDiagnostic(
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Ошибка отображения инструмента",
            800,
          ),
          componentStack: sanitizeUiDiagnostic(info.componentStack || "", 800),
        }),
    );
  }
  private retry = () =>
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  render() {
    if (!this.state.failed)
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    return (
      <section
        role="alert"
        aria-label={`Ошибка панели «${this.props.title}»`}
        style={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          color: "var(--text)",
          background: "var(--surface)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 400, minWidth: 0 }}>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {this.props.title}
          </h3>
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--secondary)",
            }}
          >
            Не удалось отобразить этот инструмент. Остальные панели продолжают
            работать. Повторите открытие панели.
          </p>
          <button
            type="button"
            onClick={this.retry}
            aria-label={`Повторить открытие панели «${this.props.title}»`}
          >
            Повторить
          </button>
        </div>
      </section>
    );
  }
}
