import type { Profile } from "../shared/types";
const profileNames: Record<string, string> = {
  analyst: "Аналитик",
  spec: "Проверка спецификаций",
  architect: "Архитектор",
  backend: "Бэкенд",
  database: "Разработчик БД",
  designer: "Дизайнер",
  frontend: "Фронтенд",
  security: "Безопасность",
  devops: "DevOps",
  "technical-writer": "Технический писатель",
  qa: "Тестирование",
  reviewer: "Ревью кода",
  diagnostics: "Диагностика",
  "gigacode-ui": "GigaCode UI",
};
export function profileName(
  profile: Partial<Profile> | undefined,
  fallback = "Профиль",
) {
  return (
    (profile?.builtin && profile.id && profileNames[profile.id]) ||
    profile?.name ||
    profile?.id ||
    fallback
  );
}
export const toolRunning = (status: string) =>
  ["in_progress", "running", "executing", "started"].includes(status);
export const toolFailed = (status: string) =>
  ["failed", "error"].includes(status);
export const toolComplete = (status: string) =>
  ["completed", "success", "succeeded"].includes(status);
export function toolStatus(status: string) {
  return (
    {
      pending: "В очереди",
      in_progress: "Выполняется",
      running: "Выполняется",
      executing: "Выполняется",
      started: "Выполняется",
      completed: "Готово",
      success: "Готово",
      succeeded: "Готово",
      failed: "Ошибка",
      error: "Ошибка",
      cancelled: "Отменён",
      canceled: "Отменён",
      waiting: "Ожидание",
      awaiting_permission: "Нужно разрешение",
    }[status] || "Состояние не сообщено"
  );
}
/** Summaries contain action labels, never serialized arguments. Full data stays in details. */
export function shortToolTitle(title: string) {
  const name = title
    .split(":")[0]
    .split(/[\n\r{\[]/)[0]
    .replace(/["`]/g, "")
    .trim();
  if (!name) return "Вызов инструмента";
  const actions: [RegExp, string][] = [
    [/browser.*capture|capture.*browser/i, "Снимок страницы"],
    [/browser.*inspect/i, "Чтение страницы"],
    [/browser.*create/i, "Открытие браузера"],
    [/browser.*navigate/i, "Переход на страницу"],
    [/browser.*act/i, "Действие на странице"],
    [/todo.*write|todo.*replace|update.*plan/i, "Обновление плана"],
    [/artifact.*register/i, "Сохранение материала"],
    [/question.*create|ask.*user/i, "Вопрос пользователю"],
    [/run_shell_command|shell_command|execute.*command/i, "Команда терминала"],
    [/read_file|readfile/i, "Чтение файла"],
    [/write_file|writefile/i, "Запись файла"],
    [/edit_file|editfile|apply_patch/i, "Изменение файла"],
    [/list_directory|list_files/i, "Список файлов"],
    [/search_file|grep_search|glob/i, "Поиск в проекте"],
    [/web_search/i, "Поиск в интернете"],
  ];
  return (
    actions.find(([pattern]) => pattern.test(name))?.[1] ||
    name
      .replace(/^mcp__[^_]+__/, "")
      .replace(/_/g, " ")
      .slice(0, 64)
  );
}

export function elapsedLabel(milliseconds: number): string {
  if (milliseconds < 1000) return "меньше 1 с";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60
    ? `${seconds} с`
    : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}
