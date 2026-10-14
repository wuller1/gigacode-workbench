import { sanitizeUiDiagnostic } from "./ToolBoundary";
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: string; attempt: number }
> {
  state: { error?: string; attempt: number } = { attempt: 0 };
  private timer?: ReturnType<typeof setTimeout>;
  static getDerivedStateFromError(error: unknown) {
    return {
      error: sanitizeUiDiagnostic(
        error instanceof Error ? error.message : String(error),
        2000,
      ),
    };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(
      "Renderer failure",
      sanitizeUiDiagnostic(error.message, 2000),
    );
    if (this.state.attempt === 0)
      this.timer = setTimeout(
        () => this.setState({ error: undefined, attempt: 1 }),
        250,
      );
  }
  componentWillUnmount() {
    clearTimeout(this.timer);
  }
  render() {
    if (!this.state.error)
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    return (
      <main className="startup" role="alert">
        <h1>Не удалось отобразить рабочее пространство</h1>
        <p>{this.state.error}</p>
        <p>
          Сохранённые разговоры и файлы не удалены. Выполняющийся запрос не
          будет автоматически отправлен повторно.
        </p>
        <button
          onClick={() =>
            this.setState((state) => ({
              error: undefined,
              attempt: state.attempt + 1,
            }))
          }
        >
          Повторить отображение
        </button>
      </main>
    );
  }
}
