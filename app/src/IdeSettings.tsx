import { useEffect, useState } from "react";
import type { AppState } from "../shared/types";
import type { Invoke } from "./api";
export function IdeSettings({ state, run }: { state: AppState; run: Invoke }) {
  const [installation, setInstallation] = useState<any>(),
    [engines, setEngines] = useState<any[]>([]),
    [projectId, setProjectId] = useState(state.projects[0]?.id || ""),
    [status, setStatus] = useState<any>();
  const refresh = async () => {
    setInstallation(await run("ide.installation"));
    setEngines((await run("ide.list")) || []);
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <h3>IDE и языковые инструменты</h3>
      <p className="muted">
        Общий редактор для вас и агента. Сервисы запускаются при открытии
        проекта и продолжают работать при переключении панелей.
      </p>
      <dl className="ide-installation">
        <dt>Движок</dt>
        <dd>Theia {installation?.version || "1.76.0"}</dd>
        <dt>Локальный Node.js</dt>
        <dd>{installation?.nodeInstalled ? "Установлен" : "Не установлен"}</dd>
        <dt>Расширения</dt>
        <dd>
          {installation?.extensionsInstalled
            ? "Подготовлены"
            : "Не установлены"}
        </dd>
      </dl>
      {!installation?.ready && (
        <p role="alert">
          Установите IDE командой <code>npm run setup:ide</code> из каталога{" "}
          <code>app</code>. Она подготовит закреплённые версии локально.
        </p>
      )}
      <label className="field">
        Проект
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setStatus(undefined);
          }}
        >
          {state.projects
            .filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <div className="inline-field">
        <button
          disabled={!projectId || !installation?.ready}
          onClick={async () => {
            setStatus(await run("ide.status", { projectId }));
            void refresh();
          }}
        >
          Проверить окружение проекта
        </button>
        <button
          disabled={!projectId || !installation?.ready}
          onClick={async () => {
            await run("ide.command", {
              projectId,
              id: "workbench.recovery",
              args: [],
            });
          }}
        >
          Восстановление файлов
        </button>
      </div>
      {status && (
        <>
          <p>
            {status.plugins.length} расширений · {status.documents.length}{" "}
            открытых файлов · {status.problems.errors} ошибок
          </p>
          <dl className="ide-installation">
            <dt>JDK языкового сервера</dt>
            <dd>{status.toolchains.languageServerJavaHome || "Не настроен"}</dd>
            <dt>Maven</dt>
            <dd>{status.toolchains.mavenHome || "Не настроен"}</dd>
          </dl>
        </>
      )}
      <p className="fine-print">
        JDK проекта, Python-интерпретатор, formatter, задачи сборки и
        конфигурации отладки задаются в нативных настройках IDE и файлах
        проекта. Локальный JDK 21 нужен языковому серверу; проект может
        использовать другой JDK. Расширения устанавливаются из Open VSX или
        разрешённого VSIX.
      </p>
      {engines.map((engine) => (
        <div className="ide-engine-row" key={engine.id}>
          <strong>
            {state.projects.find((p) => engine.projectIds.includes(p.id))
              ?.name || engine.root}
          </strong>
          <span>{engine.status}</span>
          <code>{engine.root}</code>
          {engine.error && <p role="alert">{engine.error}</p>}
          <div className="inline-field">
            <button
              onClick={async () => {
                await run("ide.restart", { projectId: engine.projectIds[0] });
                void refresh();
              }}
            >
              Перезапустить
            </button>
            <button
              onClick={async () => {
                await run("ide.stop", { projectId: engine.projectIds[0] });
                void refresh();
              }}
            >
              Остановить
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
