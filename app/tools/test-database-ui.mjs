/** Actual Electron renderer + IPC + own MCP child + disposable PostgreSQL. No model or mock rows. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright";
import pg from "pg";
import { databaseEvidence } from "./database-evidence.mjs";
const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, ".."),
  temp = process.env.WORKBENCH_DATABASE_TEST_TEMP,
  url = new URL(process.env.WORKBENCH_DATABASE_TEST_URL),
  admin = new pg.Client({ connectionString: url.toString() });
const results = [],
  errors = [];
let app;
const evidence = path.resolve(root, "../docs/suite/evidence");
const check = async (name, fn) => {
  await fn();
  results.push(name);
  console.log("PASS", name);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  await admin.connect();
  await admin.query(
    "CREATE TABLE public.desktop_data(id bigint PRIMARY KEY, note text, amount numeric(40,20)); INSERT INTO desktop_data VALUES(1,'original',12345678901234567890.12345678901234567890),(2,NULL,NULL); CREATE SCHEMA additional;CREATE TABLE additional.other_data(id int);",
  );
  const env = {
    ...process.env,
    WORKBENCH_DATA_DIR: path.join(temp, "desktop"),
    WORKBENCH_CLI_PATH: path.join(root, "tests/fixtures/acp-fixture.mjs"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env))
    if (/OPENAI|OPENROUTER|API_KEY/.test(k)) delete env[k];
  const packaged = process.argv.includes("--packaged");
  app = await _electron.launch({
    executablePath: packaged
      ? path.join(root, "release/win-unpacked/GigaCode Workbench.exe")
      : require("electron"),
    args: packaged ? [] : [root],
    env,
    timeout: 30000,
  });
  const p = await app.firstWindow();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.waitForFunction(() => Boolean(window.workbench));
  const invoke = (method, params = {}) =>
    p.evaluate(
      ({ method, params }) => window.workbench.invoke(method, params),
      { method, params },
    );
  const projectPath = path.join(temp, "project");
  await fs.mkdir(projectPath);
  const project = await invoke("project.create", {
      name: "Database desktop acceptance",
      path: projectPath,
    }),
    task = await invoke("task.create", {
      projectId: project.id,
      title: "Live database workflow",
    });
  await invoke("session.create", {
    taskId: task.id,
    title: "Database assistant",
  });
  await p
    .locator(".task-select")
    .filter({ hasText: "Live database workflow" })
    .click();
  const connection = await invoke("database.connection.save", {
    connection: {
      name: "Local acceptance",
      environment: "Disposable",
      projectIds: [project.id],
      transport: "postgres-mcp",
      host: url.hostname,
      port: Number(url.port),
      database: "postgres",
      user: url.username,
      readOnly: false,
    },
    secret: url.password,
  });
  const console = await invoke("database.console.create", {
    projectId: project.id,
    connectionId: connection.id,
    title: "SQL A",
    sql: "SELECT 9223372036854775807::bigint AS id, 'desktop' AS note;",
  });
  await p.getByRole("button", { name: "Базы данных", exact: true }).click();
  await p.getByRole("button", { name: "Чат", exact: true }).click();
  await check(
    "SQL editor executes through actual MCP and displays precise result without another click",
    async () => {
      await p.getByRole("button", { name: "Выполнить", exact: true }).click();
      await p
        .locator(".db-grid td")
        .filter({ hasText: "9223372036854775807" })
        .waitFor();
      assert(
        (await p
          .locator(".db-grid td")
          .filter({ hasText: "desktop" })
          .count()) === 1,
        "Actual SQL result missing",
      );
    },
  );
  await check(
    "Keyboard SQL execution and persisted console draft",
    async () => {
      const editor = p.getByRole("textbox", { name: "SQL редактор" });
      await editor.click();
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.insertText("SELECT 81 AS keyboard_result;");
      await p.keyboard.press("ControlOrMeta+Enter");
      await p
        .locator(".db-grid th")
        .filter({ hasText: "keyboard_result" })
        .waitFor();
      const s = await invoke("database.snapshot", { projectId: project.id });
      assert(
        s.consoles
          .find((c) => c.id === console.id)
          .sql.includes("keyboard_result"),
        "SQL draft was not persisted",
      );
    },
  );
  await check(
    "Schema popup selects several schemas, filters at source and preserves the SQL document",
    async () => {
      await p
        .getByRole("button", { name: "Выбрать видимые схемы", exact: true })
        .click();
      const popup = p.getByRole("region", {
        name: "Видимые схемы",
        exact: true,
      });
      await popup
        .getByRole("checkbox", { name: "additional", exact: true })
        .check();
      await p.keyboard.press("Escape");
      await popup.waitFor({ state: "detached" });
      await p
        .locator(".db-object-tree button")
        .filter({ hasText: "other_data" })
        .waitFor();
      await p
        .getByRole("textbox", { name: "Поиск объекта БД" })
        .fill("desktop_data");
      await p.waitForFunction(
        () => document.querySelectorAll(".db-object-tree button").length === 1,
      );
      assert(
        (await p.locator(".db-object-tree button").innerText()).includes(
          "desktop_data",
        ),
        "Server catalog search kept an unrelated object",
      );
      await p.getByRole("textbox", { name: "Поиск объекта БД" }).fill("");
      await p
        .locator(".db-object-tree button")
        .filter({ hasText: "other_data" })
        .waitFor();
      await p
        .getByRole("button", { name: "Выбрать видимые схемы", exact: true })
        .click();
      await popup
        .getByRole("checkbox", { name: "public", exact: true })
        .uncheck();
      await p.keyboard.press("Escape");
      await p.waitForFunction(
        () =>
          !document
            .querySelector(".db-object-tree")
            ?.textContent?.includes("desktop_data"),
      );
      assert(
        (
          await p.getByRole("textbox", { name: "SQL редактор" }).innerText()
        ).includes("keyboard_result"),
        "Schema filtering replaced the user's SQL",
      );
      await p
        .getByRole("button", { name: "Выбрать видимые схемы", exact: true })
        .click();
      await popup
        .getByRole("checkbox", { name: "public", exact: true })
        .check();
      await p.keyboard.press("Escape");
      await p
        .locator(".db-object-tree button")
        .filter({ hasText: "desktop_data" })
        .waitFor();
    },
  );
  await check(
    "Catalog opens table in its own document and keeps SQL console intact",
    async () => {
      await p
        .locator(".db-object-tree button")
        .filter({ hasText: "desktop_data" })
        .dblclick();
      await p.locator(".db-grid th").filter({ hasText: "amount" }).waitFor();
      assert(
        (await p.getByRole("tab", { name: "SQL A", exact: true }).count()) ===
          1,
        "Original console disappeared",
      );
    },
  );
  await check(
    "Data editor stages a cell inline and applies an actual optimistic row update",
    async () => {
      const cell = p.locator(".db-grid td").filter({ hasText: "original" });
      await cell.dblclick();
      const input = p.getByRole("textbox", {
        name: "Значение note",
        exact: true,
      });
      await input.fill("edited from desktop");
      await input.press("Enter");
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .waitFor({ state: "hidden" });
      await p.locator(".db-effect").waitFor({ state: "hidden" });
      await p
        .locator(".db-grid td")
        .filter({ hasText: "edited from desktop" })
        .waitFor();
      assert(
        (await admin.query("SELECT note FROM desktop_data WHERE id=1")).rows[0]
          .note === "edited from desktop",
        "Update did not reach PostgreSQL",
      );
      assert(
        (await p.getByRole("dialog").count()) === 0,
        "Cell editor opened a dialog",
      );
    },
  );
  await check(
    "A new row is edited inline with DEFAULT/NULL semantics and inserted on submit",
    async () => {
      await p
        .getByRole("button", { name: "Добавить строку DEFAULT", exact: true })
        .click();
      await p
        .locator(".db-grid tbody tr")
        .last()
        .locator("td")
        .nth(1)
        .dblclick();
      await p.getByRole("checkbox", { name: "DEFAULT", exact: true }).uncheck();
      const value = p.getByRole("textbox", {
        name: "Значение id",
        exact: true,
      });
      await value.fill("3");
      await value.press("Enter");
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .waitFor({ state: "hidden" });
      await p.locator(".db-effect").waitFor({ state: "hidden" });
      assert(
        (await admin.query("SELECT id,note FROM desktop_data WHERE id=3"))
          .rows[0].note === null,
        "DEFAULT insert was not committed",
      );
    },
  );
  await check(
    "Structured filters execute on PostgreSQL and can be removed without editing JSON",
    async () => {
      await p.getByRole("button", { name: "Фильтр", exact: true }).click();
      await p
        .getByRole("combobox", { name: "Столбец фильтра" })
        .selectOption("note");
      await p
        .getByRole("combobox", { name: "Оператор фильтра" })
        .selectOption("ILIKE");
      await p
        .getByRole("textbox", { name: "Значение фильтра" })
        .fill("%desktop%");
      await p.getByRole("button", { name: "Добавить условие фильтра" }).click();
      await p
        .getByRole("button", { name: "Применить фильтр", exact: true })
        .click();
      await p.waitForFunction(
        () => document.querySelectorAll(".db-grid tbody tr").length === 1,
      );
      await p.getByRole("button", { name: "Удалить условие 1" }).click();
      await p
        .getByRole("button", { name: "Применить фильтр", exact: true })
        .click();
      await p.waitForFunction(
        () => document.querySelectorAll(".db-grid tbody tr").length === 3,
      );
      await p.getByRole("button", { name: "Скрыть настройки фильтра" }).click();
    },
  );
  await check(
    "Manual transaction reports active, keeps writes private, and rollback restores actual data",
    async () => {
      await p
        .getByRole("combobox", { name: "Режим транзакции" })
        .selectOption("manual");
      await p
        .locator(".db-grid td")
        .filter({ hasText: "edited from desktop" })
        .dblclick();
      await p
        .getByRole("textbox", { name: "Значение note", exact: true })
        .fill("uncommitted");
      await p
        .getByRole("textbox", { name: "Значение note", exact: true })
        .press("Enter");
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .waitFor({ state: "hidden" });
      await p.getByRole("button", { name: "Rollback", exact: true }).waitFor();
      assert(
        (await admin.query("SELECT note FROM desktop_data WHERE id=1")).rows[0]
          .note === "edited from desktop",
        "Manual write committed unexpectedly",
      );
      await p.getByRole("button", { name: "Rollback", exact: true }).click();
      await p
        .getByRole("button", { name: "Rollback", exact: true })
        .waitFor({ state: "hidden" });
      await p
        .getByRole("button", { name: "Обновить данные таблицы", exact: true })
        .click();
      await p
        .locator(".db-grid td")
        .filter({ hasText: "edited from desktop" })
        .waitFor();
    },
  );
  await check(
    "Document close, reopen and switching preserve the independent SQL document",
    async () => {
      await p
        .getByRole("button", { name: "Закрыть desktop_data", exact: true })
        .click();
      await p.getByRole("tab", { name: "SQL A", exact: true }).click();
      assert(
        (
          await p.getByRole("textbox", { name: "SQL редактор" }).innerText()
        ).includes("keyboard_result"),
        "Switched SQL was replaced by table query",
      );
      await p
        .locator(".db-grid th")
        .filter({ hasText: "keyboard_result" })
        .waitFor();
      for (let i = 0; i < 4; i++)
        await p.getByRole("tab", { name: "SQL A", exact: true }).click();
      await p
        .locator(".db-grid th")
        .filter({ hasText: "keyboard_result" })
        .waitFor();
      assert(
        (await p.locator(".db-error").count()) === 0,
        "Console switch leaked a foreign result request",
      );
    },
  );
  const enterSql = async (sql) => {
    await p.getByRole("textbox", { name: "SQL редактор" }).click();
    await p.keyboard.press("ControlOrMeta+A");
    await p.keyboard.insertText(sql);
    await p.keyboard.press("ControlOrMeta+Enter");
  };
  await check(
    "Duplicate column labels display distinct positional values",
    async () => {
      await enterSql("SELECT 1 AS duplicate,2 AS duplicate;");
      await p.waitForFunction(
        () =>
          document.querySelectorAll(".db-grid th").length === 3 &&
          document.querySelectorAll(".db-grid th")[1].textContent ===
            "duplicate",
      );
      const cells = await p
        .locator(".db-grid tbody tr")
        .first()
        .locator("td")
        .allTextContents();
      assert(
        cells[1] === "1" && cells[2] === "2",
        "Duplicate columns showed the same value",
      );
    },
  );
  await check(
    "EXPLAIN shows the actual server plan and keeps estimates distinct from measured execution",
    async () => {
      await enterSql("EXPLAIN (FORMAT JSON) SELECT * FROM desktop_data;");
      await p
        .getByRole("button", { name: "План выполнения", exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "План выполнения", exact: true })
        .click();
      await p.locator(".db-plan-node summary").first().waitFor();
      assert(
        (await p.locator(".db-plan").innerText()).includes("EXPLAIN · оценка"),
        "Estimate was mislabeled as ANALYZE",
      );
      await p.getByRole("button", { name: "Данные", exact: true }).click();
    },
  );
  await check(
    "Server syntax errors produce a position marker and a successful new query clears the error",
    async () => {
      await enterSql("SELECT +;");
      await p.locator(".sql-server-error").waitFor();
      assert(
        (await p.locator(".db-error").innerText()).includes("42601"),
        "SQLSTATE was not visible",
      );
      await enterSql("SELECT 81 AS keyboard_result;");
      await p
        .locator(".db-grid th")
        .filter({ hasText: "keyboard_result" })
        .waitFor();
      assert(
        (await p.locator(".db-error").count()) === 0,
        "Old SQL error remained after a new execution",
      );
    },
  );
  await check(
    "Light and dark SQL palettes, desktop tree resize and layout bounds",
    async () => {
      for (const theme of ["dark", "light"]) {
        await invoke("settings.update", { patch: { theme } });
        await p.waitForFunction(
          (t) => document.documentElement.dataset.theme === t,
          theme,
        );
        const color = await p
          .locator(".cm-editor")
          .first()
          .evaluate((e) => getComputedStyle(e).backgroundColor);
        assert(
          theme === "light"
            ? color === "rgb(252, 252, 250)"
            : color === "rgb(39, 40, 34)",
          "Wrong editor theme " + color,
        );
        await fs.mkdir(evidence, { recursive: true });
        await p.screenshot({
          path: path.join(
            evidence,
            "database-runtime-" +
              theme +
              (process.platform === "darwin" ? "" : "-" + process.platform) +
              (packaged ? "-packaged" : "") +
              ".png",
          ),
        });
      }
      const separator = p.getByRole("separator", { name: "Ширина дерева БД" }),
        before = await p
          .locator(".db-navigator")
          .evaluate((e) => e.getBoundingClientRect().width);
      await separator.focus();
      await separator.press("ArrowRight");
      assert(
        (await p
          .locator(".db-navigator")
          .evaluate((e) => e.getBoundingClientRect().width)) > before,
        "Tree resize did not work",
      );
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "Outer page overflow",
      );
    },
  );
  await check(
    "SQL history reads captured SQL and target in bounded chunks and closes with Escape",
    async () => {
      await p
        .getByRole("button", { name: "Инструменты базы данных", exact: true })
        .click();
      await p
        .getByRole("menuitem", { name: "История SQL", exact: true })
        .click();
      const dialog = p.getByRole("dialog", {
        name: "История операций консоли",
      });
      await dialog
        .locator("section pre")
        .filter({ hasText: "SELECT 81 AS keyboard_result;" })
        .waitFor();
      await dialog
        .getByRole("combobox", { name: "Детали сохранённой операции" })
        .selectOption("request");
      await p.waitForFunction(() =>
        document
          .querySelector(".db-history section pre")
          ?.textContent?.includes('"params": []'),
      );
      assert(
        (await dialog.innerText()).includes('"database": "postgres"'),
        "Captured target is missing",
      );
      assert(
        !(await dialog.innerText()).includes(url.password),
        "History leaked the connection password",
      );
      await dialog
        .getByRole("tab", { name: "Журнал операций", exact: true })
        .click();
      await p.waitForFunction(() =>
        document
          .querySelector(".db-history section pre")
          ?.textContent?.includes("SELECT 81 AS keyboard_result;"),
      );
      assert(
        (await dialog.locator("section pre").innerText()).includes(
          "SELECT 81 AS keyboard_result;",
        ),
        "Durable operation ledger lost the original SQL",
      );
      await p.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    },
  );
  await check(
    "Two real windows preserve a conflicting SQL draft and can save it as a separate durable console",
    async () => {
      const opened = app.waitForEvent("window");
      await invoke("window.new");
      const second = await opened;
      await second.waitForFunction(() => Boolean(window.workbench));
      const editor = p.getByRole("textbox", { name: "SQL редактор" });
      await editor.click();
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.insertText("SELECT 100 AS first_window_draft;");
      const state = await invoke("database.snapshot", {
          projectId: project.id,
        }),
        doc = state.consoles.find((c) => c.id === console.id);
      await second.evaluate(
        ({ projectId, consoleId, revision }) =>
          window.workbench.invoke("database.console.update", {
            projectId,
            consoleId,
            revision,
            sql: "SELECT 200 AS second_window;",
          }),
        { projectId: project.id, consoleId: doc.id, revision: doc.revision },
      );
      await p
        .getByRole("button", { name: "Сохранить копию", exact: true })
        .waitFor();
      assert(
        (await editor.innerText()).includes("first_window_draft"),
        "The foreign update replaced an unsaved buffer",
      );
      await p.waitForFunction(
        async (projectId) =>
          (
            await window.workbench.invoke("database.recovery.list", {
              projectId,
            })
          ).length > 0,
        project.id,
      );
      await p
        .getByRole("button", { name: "Сохранить копию", exact: true })
        .click();
      await p
        .getByRole("tab", { name: "SQL A · копия", exact: true })
        .waitFor();
      const final = await invoke("database.snapshot", {
        projectId: project.id,
      });
      assert(
        final.consoles
          .find((c) => c.id === console.id)
          .sql.includes("second_window"),
        "Conflict copy overwrote the foreign console",
      );
      assert(
        final.consoles.some(
          (c) =>
            c.title === "SQL A · копия" && c.sql.includes("first_window_draft"),
        ),
        "Conflict draft copy was not saved",
      );
      await second.close();
    },
  );
  assert(errors.length === 0, "Renderer errors: " + errors.join("; "));
  assert(
    (await p.locator(".db-error").count()) === 0,
    "The final workspace contains an unexpected error",
  );
  await databaseEvidence(
    "database-runtime-ui" +
      (process.platform === "darwin" ? "" : "-" + process.platform) +
      (packaged ? "-packaged" : "") +
      ".json",
    {
      at: new Date().toISOString(),
      os: process.platform,
      packaged,
      cases: results.length,
      passed: results,
      rendererErrors: errors,
      runtime: await app.evaluate(() => ({
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      })),
      scope:
        "Real Electron renderer/IPC/stdio MCP/PostgreSQL, isolated cluster. No workplace MCP, GigaCode fork, VARM or unsupported platform claim.",
    },
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(
      "DB UI DIAGNOSTIC",
      await page.locator(".database-workspace").innerText(),
    );
    const diagnostic = path.join(root, "test-results/database");
    await fs.mkdir(diagnostic, { recursive: true });
    await page.screenshot({
      path: path.join(diagnostic, "database-ui-failure.png"),
    });
  }
  throw error;
} finally {
  await app?.close();
  await admin.end();
}
