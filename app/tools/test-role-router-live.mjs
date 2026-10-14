/** Opt-in real-model evaluation. Synthetic tasks only; never exports auth or raw CLI traces. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
if (process.env.WORKBENCH_LIVE_ROUTER !== "1")
  throw new Error(
    "Set WORKBENCH_LIVE_ROUTER=1 to authorize this paid real-model test.",
  );
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = process.env.WORKBENCH_TEST_MODEL;
if (!model || !process.env.OPENAI_API_KEY)
  throw new Error(
    "A test model and native provider authentication must be supplied privately.",
  );
const folder = await fs.mkdtemp(
  path.join(os.tmpdir(), "workbench-router-eval-"),
);
try {
  const modulePath = path.join(folder, "router.mjs");
  const routerSourceSha256 = createHash("sha256")
    .update(await fs.readFile(path.join(root, "electron/role-router.ts")))
    .digest("hex");
  await require("esbuild").build({
    entryPoints: [path.join(root, "electron/role-router.ts")],
    outfile: modulePath,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { routeWithQwen } = await import(pathToFileURL(modulePath).href);
  const cli = require.resolve("@qwen-code/qwen-code");
  const profiles = [];
  for (const file of (
    await fs.readdir(path.join(root, "../workbench/profiles"))
  )
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const content = await fs.readFile(
      path.join(root, "../workbench/profiles", file),
      "utf8",
    );
    profiles.push({
      id: file.slice(0, -3),
      name: file.slice(0, -3),
      description:
        content
          .split("\n")
          .find((x) => x.trim() && !x.startsWith("#"))
          ?.slice(0, 350) ?? "",
    });
  }
  const cases = [
    [
      "functional-brief",
      "analyst",
      "Помоги описать новую функцию возврата платежа: сценарии, исключения, вопросы и рекомендации.",
    ],
    [
      "criticism-is-not-formal-sdd",
      "analyst",
      "Найди противоречия и недостающие сведения в нашем черновике описания функции. Формальный SDD сейчас не нужен.",
    ],
    [
      "explicit-sdd",
      "spec",
      "Теперь составь формальную SDD-спецификацию с контрактами и проверяемыми критериями.",
    ],
    [
      "contextual-implementation",
      "backend",
      "Теперь реализуй это.",
      [
        {
          role: "user",
          content:
            "Мы приняли контракт серверного API возвратов для Spring Boot сервиса. Нужно реализовать серверное поведение.",
        },
      ],
    ],
    [
      "small-ui-fix",
      "frontend",
      "Исправь отступ кнопки в React-компоненте по существующим токенам. Проверь результат; новый дизайн не нужен.",
    ],
    [
      "postgres-performance",
      "database",
      "Проанализируй EXPLAIN запроса PostgreSQL и предложи индекс с проверкой его пользы.",
    ],
    [
      "jenkins-operation",
      "devops",
      "Найди Jenkins job нашего проекта, проверь параметры и запусти разрешённую сборку на выбранном стенде.",
    ],
    [
      "investigate-failure",
      "diagnostics",
      "Выясни, почему приложение иногда зависает: воспроизведи и различи гипотезы. Пока код не меняй.",
    ],
    [
      "independent-review",
      "reviewer",
      "Проведи независимое code review этого diff относительно принятого контракта.",
    ],
    [
      "behavior-acceptance",
      "qa",
      "Выполни приёмочное тестирование готовой функции в живом приложении, собери доказательства и дефекты.",
    ],
    [
      "personal-electron-slice",
      "gigacode-ui",
      "Реализуй сохранение активной ACP-сессии при смене окна в нашей личной Electron оболочке GigaCode UI.",
    ],
    [
      "existing-user-guide",
      "technical-writer",
      "Составь руководство пользователя по уже реализованному и проверенному поведению приложения.",
    ],
  ];
  const results = [];
  let hostClassifierLaunches = 0;
  for (const [id, expected, request, history = []] of cases) {
    const start = Date.now();
    try {
      const result = await routeWithQwen(
        {
          currentProfileId: "analyst",
          project: {
            id: "synthetic",
            name: "Synthetic acceptance project",
            directory: "example",
          },
          task: {
            id: "task",
            title: "Requested work",
            description:
              "Use only the current synthetic user request and supplied conversation.",
          },
          request,
          history,
          profiles,
        },
        {
          executable: cli,
          model,
          authArgs: ["--auth-type", "openai"],
          signal: AbortSignal.timeout(35000),
          onAttempt: () => hostClassifierLaunches++,
        },
      );
      results.push({
        id,
        expected,
        actual: result.profileId,
        confidence: result.confidence,
        pass: result.profileId === expected,
        elapsedMs: Date.now() - start,
      });
    } catch (error) {
      results.push({
        id,
        expected,
        pass: false,
        failure:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Unknown failure",
        elapsedMs: Date.now() - start,
      });
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  const report = {
    date: new Date().toISOString(),
    cli: "@qwen-code/qwen-code@0.25.1",
    model,
    evidence:
      "actual CLI and external real-model routing; synthetic cases, no development-task execution",
    hostClassifierDispatches: cases.length,
    hostClassifierLaunches,
    routerSourceSha256,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
    limitations:
      "Small single-model sample; does not establish superiority, workplace-model quality, Giga compatibility or all task outcomes.",
  };
  const destination = process.env.WORKBENCH_ROUTER_REPORT;
  if (destination)
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
  console.log(
    JSON.stringify({
      passed: report.passed,
      failed: report.failed,
      hostClassifierDispatches: cases.length,
    }),
  );
  if (report.failed) process.exitCode = 1;
} finally {
  await fs.rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
