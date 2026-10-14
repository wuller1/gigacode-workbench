import { sanitizeUiDiagnostic } from "./ToolBoundary";
import { Component, type ErrorInfo, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return {
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2000,
      ),
    };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(
      "Renderer failure",
      sanitizeUiDiagnostic(error.message, 2000),
    );
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="startup" role="alert">
        <h1>Не удалось отобразить рабочее пространство</h1>
        <p>{this.state.error}</p>
        <p>
          Сохранённые разговоры и файлы не удалены. Выполняющийся запрос не
          будет автоматически отправлен повторно.
        </p>
        <button onClick={() => location.reload()}>
          Перезагрузить интерфейс
        </button>
      </main>
    );
  }
}
