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
// Playwright's waitForFunction polls the immediate truthiness of a return value.
// An async predicate returns a truthy Promise even when it later resolves false.
// Await the evaluated value on the Node side before deciding to finish the wait.
const waitForHost = async (page, predicate, argument, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(
    "Timed out awaiting observed host state: " +
      predicate.toString().slice(0, 180),
  );
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  await admin.connect();
  await admin.query(
    "CREATE TABLE public.desktop_data(id bigint PRIMARY KEY, note text, amount numeric(40,20)); INSERT INTO desktop_data VALUES(1,'original',12345678901234567890.12345678901234567890),(2,NULL,NULL); CREATE SCHEMA additional;CREATE TABLE additional.other_data(id int);CREATE TABLE public.desktop_relation(id int PRIMARY KEY,desktop_id bigint CONSTRAINT desktop_relation_target REFERENCES public.desktop_data(id) ON DELETE CASCADE);",
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
  const runtime = await app.evaluate(() => ({
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
  const p = await app.firstWindow();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.stack || String(e)));
  p.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await p.waitForFunction(() => Boolean(window.workbench));
  await check(
    "Asynchronous host waits reject false results instead of accepting a Promise as success",
    async () => {
      let timedOut = false;
      try {
        await waitForHost(p, async () => false, undefined, 120);
      } catch (error) {
        timedOut = error.message.includes("Timed out");
      }
      assert(timedOut, "Async false was accepted as a passing condition");
    },
  );
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
      assert(
        (await p.getByRole("textbox", { name: "SQL редактор" }).count()) === 0,
        "Table document reserved its workspace for an empty SQL editor",
      );
      await p
        .getByRole("button", {
          name: "Показать SQL редактор таблицы",
          exact: true,
        })
        .waitFor();
    },
  );
  await check(
    "Grid keyboard editing preserves row identity, blocks result transitions and leaves PostgreSQL unchanged until submit",
    async () => {
      // A second captured result makes the result selector part of the guard check.
      const before = await invoke("database.snapshot", {
        projectId: project.id,
      });
      const tableConsole = before.consoles.find(
        (c) => c.object?.kind === "table" && !c.closed,
      );
      const priorJob = before.jobs
        .filter((j) => j.consoleId === tableConsole.id)
        .at(-1)?.id;
      await p
        .getByRole("button", { name: "Обновить данные таблицы", exact: true })
        .click();
      await waitForHost(
        p,
        async ({ projectId, consoleId, priorJob }) => {
          const state = await window.workbench.invoke("database.snapshot", {
            projectId,
          });
          const latest = state.jobs
            .filter((j) => j.consoleId === consoleId)
            .at(-1);
          return (
            latest && latest.id !== priorJob && latest.status === "completed"
          );
        },
        { projectId: project.id, consoleId: tableConsole.id, priorJob },
      );
      await p
        .locator('.db-grid [data-row="0"][data-column="1"]')
        .filter({ hasText: "original" })
        .waitFor();
      await p.getByRole("button", { name: "Фильтр", exact: true }).click();
      const cell = (row, column) =>
        p.locator(`.db-grid [data-row="${row}"][data-column="${column}"]`);
      const assertFocus = async (row, column) => {
        await p.waitForFunction(
          ({ row, column }) => {
            const active = document.activeElement;
            return (
              active?.getAttribute("data-row") === String(row) &&
              active?.getAttribute("data-column") === String(column)
            );
          },
          { row, column },
        );
      };
      const assertTransitionsBlocked = async () => {
        for (const [role, name] of [
          ["combobox", "Результат запроса"],
          ["combobox", "Строк на странице"],
          ["button", "Предыдущая страница"],
          ["button", "Следующая страница"],
          ["button", "Обновить данные таблицы"],
          ["button", "Применить фильтр"],
        ])
          assert(
            await p.getByRole(role, { name, exact: true }).isDisabled(),
            "Uncommitted cell allowed transition: " + name,
          );
      };
      const current = await invoke("database.snapshot", {
        projectId: project.id,
      });
      const captured = current.jobs
        .filter((j) => j.consoleId === tableConsole.id)
        .at(-1)
        .results.at(-1).id;
      await p
        .locator(`.db-grid[data-editable="true"][data-result-id="${captured}"]`)
        .waitFor();
      await cell(0, 1).focus();
      await assertFocus(0, 1);
      await p.keyboard.press("F2");
      let editor = p.getByRole("textbox", {
        name: "Значение note",
        exact: true,
      });
      await editor.fill("keyboard-only staged");
      await assertTransitionsBlocked();
      await editor.press("Tab");
      await assertFocus(0, 2);
      await assertTransitionsBlocked();
      await p.keyboard.press("F2");
      editor = p.getByRole("textbox", { name: "Значение amount", exact: true });
      await editor.press("Shift+Tab");
      await assertFocus(0, 1);
      await p.keyboard.press("F2");
      editor = p.getByRole("textbox", { name: "Значение note", exact: true });
      await editor.fill("keyboard-only staged twice");
      await editor.press("Enter");
      await assertFocus(1, 1);
      await p.keyboard.press("ArrowLeft");
      await assertFocus(1, 0);
      await p.keyboard.press("F2");
      await p
        .getByRole("textbox", { name: "Значение id", exact: true })
        .fill("77");
      await p.keyboard.press("Escape");
      await assertFocus(1, 0);
      assert(
        (await admin.query("SELECT id,note FROM desktop_data ORDER BY id")).rows
          .map((r) => r.id + ":" + r.note)
          .join("|") === "1:original|2:null",
        "Staged keyboard edit wrote to PostgreSQL or changed another row",
      );
      await p
        .getByRole("button", {
          name: "Отменить локальные изменения",
          exact: true,
        })
        .click();
      await p
        .getByRole("button", { name: "Применить · 1", exact: true })
        .waitFor({ state: "hidden" });
      await p
        .getByRole("button", { name: "Скрыть настройки фильтра", exact: true })
        .click();
      assert(
        (await p.locator(".db-error").count()) === 0,
        "Keyboard navigation produced a database error",
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
        .getByRole("button", {
          name: "Показать SQL редактор таблицы",
          exact: true,
        })
        .click();
      await p.getByRole("textbox", { name: "SQL редактор" }).waitFor();
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
        .getByRole("combobox", { name: "Режим транзакции" })
        .selectOption("auto");
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
    "Table metadata uses compact real columns/keys/indexes with inline highlighted definitions",
    async () => {
      await p.getByRole("button", { name: "Структура", exact: true }).click();
      const metadata = p.getByRole("region", { name: "Структура объекта БД" });
      await p.getByRole("table", { name: "Столбцы таблицы" }).waitFor();
      assert(
        (await p.locator(".db-console-editor").count()) === 1,
        "Metadata view duplicated the SQL editor",
      );
      assert(
        (
          await p.getByRole("table", { name: "Столбцы таблицы" }).innerText()
        ).includes("numeric(40,20)"),
        "Actual numeric precision missing from catalog inspector",
      );
      await p.getByRole("tab", { name: /Ключи/ }).click();
      await p
        .getByRole("table", { name: "Ключи и ограничения PostgreSQL" })
        .waitFor();
      assert(
        (
          await p
            .getByRole("table", { name: "Ключи и ограничения PostgreSQL" })
            .innerText()
        ).includes("desktop_data_pkey"),
        "Real PostgreSQL primary key missing",
      );
      await p.getByRole("tab", { name: /Индексы/ }).click();
      assert(
        (
          await p.getByRole("table", { name: "Индексы PostgreSQL" }).innerText()
        ).includes("desktop_data_pkey"),
        "Real PostgreSQL index missing",
      );
      const expand = p.locator(".db-structure-expand").first();
      await expand.click();
      await p.locator(".db-structure .cm-editor").waitFor();
      await invoke("database.snapshot", { projectId: project.id });
      assert(
        (await p.locator(".db-console-editor").count()) === 1,
        "Metadata refresh duplicated a keyed editor",
      );
      assert(
        (await p.locator(".db-structure .cm-editor").innerText()).includes(
          "CREATE UNIQUE INDEX",
        ),
        "Inline highlighted SQL is not actual index definition",
      );
      await p.getByRole("button", { name: "Данные", exact: true }).click();
    },
  );
  await check(
    "Relations graph reads actual foreign keys and follows pointer across classic scrollbar appearance at reduced zoom",
    async () => {
      const reducedGraph = await p.addStyleTag({
        content: ".db-relations { width:min(550px,100%); max-width:550px }",
      });
      await p.getByRole("button", { name: "Связи", exact: true }).click();
      const graph = p.getByRole("region", {
        name: "Диаграмма внешних ключей",
        exact: true,
      });
      await p.locator(".db-relations-node").first().waitFor();
      assert(
        (await p.locator(".db-relations-node").count()) === 2,
        "Graph did not read actual PostgreSQL neighborhood",
      );
      const choices = p.getByRole("combobox", { name: "Выбрать внешний ключ" });
      const oid = await choices
        .locator("option")
        .filter({ hasText: "desktop_relation_target" })
        .getAttribute("value");
      await choices.selectOption(oid);
      const inspector = p.getByRole("region", {
        name: "Свойства внешнего ключа desktop_relation_target",
      });
      await inspector.waitFor();
      assert(
        (await inspector.innerText()).includes("desktop_id") &&
          (await inspector.innerText()).includes("CASCADE"),
        "FK columns/actions missing",
      );
      // macOS horizontal scrollbars remain overlays even with custom scrollbar
      // CSS. Reserve the same 16px content-box space as a classic track when
      // real overflow appears; the allocated border box must stay unchanged.
      await graph.evaluate((element) => {
        const viewport = element.querySelector(".db-relations-viewport");
        const stage = element.querySelector(".db-relations-stage");
        viewport.classicTrackObserver = new MutationObserver(() => {
          viewport.style.borderBottom =
            viewport.scrollWidth > viewport.clientWidth + 1
              ? "16px solid transparent"
              : "0px";
        });
        viewport.classicTrackObserver.observe(stage, {
          attributes: true,
          attributeFilter: ["style"],
        });
      });
      const header = p.getByRole("button", {
        name: "Таблица public.desktop_data, выбранная",
        exact: true,
      });
      const card = p.locator(
        '.db-relations-node[aria-label="public.desktop_data"]',
      );
      // Inspector appearance changes the canvas height. Wait for the actual
      // header to stabilize before measuring or placing the mouse on it.
      await header.hover({ position: { x: 30, y: 15 } });
      const position = await card.evaluate((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
      }));
      const before = await card.boundingBox();
      await header.focus();
      await header.press("ArrowRight");
      await p.waitForFunction(
        ({ left }) =>
          Number.parseFloat(
            document.querySelector(
              '.db-relations-node[aria-label="public.desktop_data"]',
            ).style.left,
          ) ===
          left + 10,
        position,
      );
      const after = await card.boundingBox();
      assert(
        after.x > before.x,
        "Keyboard move did not move actual graph card",
      );
      await header.press("Home");
      await p.waitForFunction(({ left, top }) => {
        const element = document.querySelector(
          '.db-relations-node[aria-label="public.desktop_data"]',
        );
        return (
          Number.parseFloat(element.style.left) === left &&
          Number.parseFloat(element.style.top) === top
        );
      }, position);
      await header.hover({ position: { x: 30, y: 15 } });
      const box = await header.boundingBox();
      const dragBefore = await card.boundingBox();
      const viewportBefore = await graph
        .locator(".db-relations-viewport")
        .evaluate((element) => ({
          clientHeight: element.clientHeight,
          offsetHeight: element.offsetHeight,
        }));
      const nodeOid = await card.getAttribute("data-oid");
      await p.mouse.move(box.x + 30, box.y + 15);
      await p.mouse.down();
      await p.waitForFunction(
        (oid) =>
          document.querySelector(".db-relations")?.dataset.dragging === oid,
        nodeOid,
      );
      await p.mouse.move(box.x + 85, box.y + 40, { steps: 5 });
      await p.mouse.up();
      await p.waitForFunction(() => {
        const graph = document.querySelector(".db-relations");
        return graph && !graph.dataset.dragging;
      });
      await p.waitForFunction(({ clientHeight, offsetHeight }) => {
        const viewport = document.querySelector(".db-relations-viewport");
        const moved = viewport
          .querySelector('.db-relations-node[aria-label="public.desktop_data"]')
          .getBoundingClientRect();
        const key = [
          viewport.clientHeight,
          viewport.offsetHeight,
          moved.x,
          moved.y,
        ].join(":");
        const previous = viewport.stableDragGeometry;
        viewport.stableDragGeometry = {
          key,
          frames: previous?.key === key ? previous.frames + 1 : 0,
        };
        return (
          viewport.clientHeight <= clientHeight - 15 &&
          viewport.offsetHeight === offsetHeight &&
          viewport.stableDragGeometry.frames >= 3
        );
      }, viewportBefore);
      await p.waitForFunction(({ x, y }) => {
        const moved = document
          .querySelector('.db-relations-node[aria-label="public.desktop_data"]')
          .getBoundingClientRect();
        return Math.abs(moved.x - x - 55) < 2 && Math.abs(moved.y - y - 25) < 2;
      }, dragBefore);
      assert(
        Math.abs((await card.boundingBox()).x - dragBefore.x - 55) < 2,
        "Dragging graph table did not follow pointer",
      );
      assert(
        (await p.evaluate(() => window.getSelection()?.toString() || "")) ===
          "",
        "Dragging selected table text instead of moving its header",
      );
      await graph.evaluate((element) => {
        const viewport = element.querySelector(".db-relations-viewport");
        viewport.classicTrackObserver.disconnect();
        delete viewport.classicTrackObserver;
        delete viewport.stableDragGeometry;
        viewport.style.removeProperty("border-bottom");
      });
      await reducedGraph.evaluate((element) => element.remove());
      await p
        .getByRole("button", {
          name: "Уменьшить масштаб диаграммы",
          exact: true,
        })
        .click();
      await p
        .getByRole("button", {
          name: "Восстановить расположение таблиц",
          exact: true,
        })
        .click();
      await p.screenshot({
        path: path.join(
          evidence,
          "database-runtime-relations" +
            (process.platform === "darwin" ? "" : "-" + process.platform) +
            (packaged ? "-packaged" : "") +
            ".png",
        ),
      });
      await p
        .getByRole("button", {
          name: "Открыть таблицу public.desktop_relation",
          exact: true,
        })
        .click();
      await p
        .getByRole("tab", { name: "desktop_relation", exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "Закрыть desktop_relation", exact: true })
        .click();
      await p.getByRole("tab", { name: "desktop_data", exact: true }).click();
      await p.getByRole("button", { name: "Данные", exact: true }).click();
    },
  );
  await check(
    "Document close rejects work added during confirmation; reopen and switching preserve independent SQL",
    async () => {
      // Create this scenario's transaction explicitly, rather than relying on
      // a previous test leaving a manual session open.
      await p
        .getByRole("combobox", { name: "Режим транзакции" })
        .selectOption("manual");
      await p
        .getByRole("button", { name: "Обновить данные таблицы", exact: true })
        .click();
      await p.getByRole("button", { name: "Rollback", exact: true }).waitFor();
      await p
        .getByRole("button", { name: "Закрыть desktop_data", exact: true })
        .click();
      const closeTransaction = p.getByRole("dialog", {
        name: "Откатить транзакцию и закрыть вкладку?",
      });
      await closeTransaction.waitFor();
      // Simulate a real second window/agent submitting to the same console
      // while the first window is waiting for the user's rollback approval.
      const stateBeforeApproval = await invoke("database.snapshot", {
        projectId: project.id,
      });
      const closingConsole = stateBeforeApproval.consoles.find(
        (c) => c.title === "desktop_data" && !c.closed,
      );
      const concurrentJob = await invoke("database.execute", {
        projectId: project.id,
        consoleId: closingConsole.id,
        sql: "SELECT 19 AS submitted_during_close_question",
        operationId: crypto.randomUUID(),
      });
      await waitForHost(
        p,
        async ({ projectId, jobId }) => {
          const state = await window.workbench.invoke("database.snapshot", {
            projectId,
          });
          return state.jobs.some(
            (j) => j.id === jobId && j.status === "completed",
          );
        },
        { projectId: project.id, jobId: concurrentJob.id },
      );
      await closeTransaction
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await closeTransaction.waitFor({ state: "hidden" });
      await p
        .locator(".db-error")
        .filter({ hasText: "появилась новая операция" })
        .waitFor();
      const refused = await invoke("database.snapshot", {
        projectId: project.id,
      });
      assert(
        !refused.consoles.find((c) => c.id === closingConsole.id).closed &&
          refused.leases.some(
            (l) =>
              l.id === closingConsole.leaseId && l.transaction === "active",
          ),
        "Stale approval hid the document or rolled back new work",
      );
      await p
        .getByRole("button", { name: "Закрыть desktop_data", exact: true })
        .click();
      await closeTransaction.waitFor();
      await closeTransaction
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await p
        .getByRole("tab", { name: "desktop_data", exact: true })
        .waitFor({ state: "hidden" });
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
    "Closing immediately after typing flushes the SQL draft before hiding and reopening the document",
    async () => {
      const recoveries = await invoke("database.recovery.list", {
        projectId: project.id,
      });
      const doc = await invoke("database.console.create", {
        projectId: project.id,
        connectionId: connection.id,
        title: "Flush on close",
        sql: "SELECT 1;",
      });
      await p.getByRole("tab", { name: "Flush on close", exact: true }).click();
      const editor = p.getByRole("textbox", { name: "SQL редактор" });
      await editor.click();
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.insertText("SELECT 314 AS closed_immediately;");
      // Do not wait for debounce: the close path itself must finish the durable save.
      await p
        .getByRole("button", { name: "Закрыть Flush on close", exact: true })
        .click();
      await p
        .getByRole("tab", { name: "Flush on close", exact: true })
        .waitFor({ state: "hidden" });
      const closed = await invoke("database.console.read", {
        projectId: project.id,
        consoleId: doc.id,
      });
      assert(
        closed.closed && closed.sql === "SELECT 314 AS closed_immediately;",
        "Close hid the document before saving its current draft",
      );
      assert(
        (await invoke("database.recovery.list", { projectId: project.id }))
          .length === recoveries.length,
        "Ordinary close generated a false recovery conflict",
      );
      await p
        .getByRole("button", { name: "Инструменты базы данных", exact: true })
        .click();
      await p
        .getByRole("menuitem", { name: "Закрытые вкладки", exact: true })
        .click();
      await p
        .getByRole("tab", { name: "Flush on close", exact: true })
        .waitFor();
      await p.waitForFunction(() =>
        document
          .querySelector('[aria-label="SQL редактор"]')
          ?.textContent?.includes("SELECT 314 AS closed_immediately;"),
      );
      assert(
        (await p.locator(".db-conflict").count()) === 0,
        "Reopened draft contains a false revision conflict",
      );
      await p
        .getByRole("button", { name: "Закрыть Flush on close", exact: true })
        .click();
      await p.getByRole("tab", { name: "SQL A", exact: true }).click();
    },
  );
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
    "Routine documents reject generic SQL execution and apply the verified server definition through the protected editor",
    async () => {
      await admin.query(
        "CREATE FUNCTION public.desktop_probe() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;",
      );
      const source = (
        await admin.query(
          "SELECT oid::text,pg_get_functiondef(oid) ddl FROM pg_proc WHERE oid='public.desktop_probe()'::regprocedure",
        )
      ).rows[0];
      const doc = await invoke("database.console.create", {
        projectId: project.id,
        connectionId: connection.id,
        title: "desktop_probe()",
        sql: source.ddl,
        object: { oid: source.oid, kind: "function" },
      });
      await invoke("database.console.open", {
        projectId: project.id,
        consoleId: doc.id,
      });
      let rejected = "";
      try {
        await invoke("database.execute", {
          projectId: project.id,
          consoleId: doc.id,
          sql: source.ddl.replace(/SELECT\s+1\b/, "SELECT 99"),
          operationId: crypto.randomUUID(),
        });
      } catch (error) {
        rejected = error.message;
      }
      assert(
        rejected.includes("routineApply"),
        "Routine document accepted generic execute before its verified definition was loaded: " +
          rejected,
      );
      assert(
        (await admin.query("SELECT public.desktop_probe() value")).rows[0]
          .value === 1,
        "Rejected generic execution still changed the routine",
      );
      await p
        .getByRole("tab", { name: "desktop_probe()", exact: true })
        .click();
      await p.waitForFunction(() =>
        [...document.querySelectorAll(".db-sql-toolbar button")].some(
          (b) => b.textContent.includes("Применить DDL") && !b.disabled,
        ),
      );
      const replacement = source.ddl.replace(/SELECT\s+1\b/, "SELECT 2");
      assert(
        replacement !== source.ddl,
        "Fixture routine body did not match the intended change",
      );
      const editor = p.getByRole("textbox", { name: "SQL редактор" }).first();
      await editor.click();
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.insertText(replacement);
      await p.keyboard.press("ControlOrMeta+Enter");
      await waitForHost(
        p,
        async ({ projectId, consoleId }) => {
          const state = await window.workbench.invoke("database.snapshot", {
            projectId,
          });
          return state.jobs.some(
            (j) =>
              j.consoleId === consoleId &&
              j.status === "completed" &&
              j.routine?.committed,
          );
        },
        { projectId: project.id, consoleId: doc.id },
      );
      const observedRoutine = (
        await admin.query(
          "SELECT public.desktop_probe() value, pg_get_functiondef('public.desktop_probe()'::regprocedure) ddl, pg_backend_pid() pid",
        )
      ).rows[0];
      assert(
        observedRoutine.value === 2,
        "Protected editor did not apply actual routine change: " +
          JSON.stringify({
            observedRoutine,
            state: await invoke("database.snapshot", { projectId: project.id }),
          }),
      );
      assert(
        (await p.locator(".db-error").count()) === 0,
        "Protected routine editing left a database error",
      );
      await p
        .getByRole("button", { name: "Закрыть desktop_probe()", exact: true })
        .click();
      await p.getByRole("tab", { name: "SQL A", exact: true }).click();
    },
  );
  await check(
    "Two real windows preserve a conflicting SQL draft and can save it as a separate durable console",
    async () => {
      const opened = app.waitForEvent("window");
      await invoke("window.new");
      const second = await opened;
      await second.waitForFunction(() => Boolean(window.workbench));
      const firstWindow = (await invoke("app.info")).windowId;
      // This scenario requires the foreign update to win before the first
      // window's 700ms autosave. Scheduling that by wall-clock timing races on
      // Windows. Hold only the actual first-window request before its real host
      // handler, then release it after the other window commits normally.
      await app.evaluate(
        ({ ipcMain, BrowserWindow }, { windowId, consoleId }) => {
          const original = ipcMain._invokeHandlers.get("workbench:invoke");
          if (typeof original !== "function")
            throw new Error("Owned database IPC barrier is unavailable");
          const gate = {
            original,
            senderId: BrowserWindow.fromId(windowId).webContents.id,
            consoleId,
            captured: undefined,
            release: undefined,
            released: false,
          };
          globalThis.__databaseConflictBarrier = gate;
          ipcMain.removeHandler("workbench:invoke");
          ipcMain.handle("workbench:invoke", async (event, method, params) => {
            if (
              !gate.released &&
              event.sender.id === gate.senderId &&
              method === "database.console.update" &&
              params.consoleId === consoleId &&
              params.sql === "SELECT 100 AS first_window_draft;"
            ) {
              gate.captured = { revision: params.revision, sql: params.sql };
              await new Promise((resolve) => {
                gate.release = resolve;
              });
            }
            return original(event, method, params);
          });
        },
        { windowId: firstWindow, consoleId: console.id },
      );
      try {
        const editor = p.getByRole("textbox", { name: "SQL редактор" });
        await editor.click();
        await p.keyboard.press("ControlOrMeta+A");
        await p.keyboard.insertText("SELECT 100 AS first_window_draft;");
        const captureDeadline = Date.now() + 10000;
        while (
          !(await app.evaluate(
            () => !!globalThis.__databaseConflictBarrier.captured,
          ))
        ) {
          if (Date.now() > captureDeadline)
            throw new Error(
              "First-window autosave did not reach the actual IPC conflict barrier",
            );
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        const state = await invoke("database.snapshot", {
            projectId: project.id,
          }),
          doc = state.consoles.find((c) => c.id === console.id);
        const held = await app.evaluate(
          () => globalThis.__databaseConflictBarrier.captured,
        );
        assert(
          held.revision === doc.revision,
          "The held real autosave did not capture the current console revision",
        );
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
        await app.evaluate(() => {
          globalThis.__databaseConflictBarrier.released = true;
          globalThis.__databaseConflictBarrier.release();
        });
        await p
          .getByRole("button", { name: "Сохранить копию", exact: true })
          .waitFor();
        assert(
          (await editor.innerText()).includes("first_window_draft"),
          "The foreign update replaced an unsaved buffer",
        );
        await waitForHost(
          p,
          async ({ projectId, consoleId, revision }) =>
            (
              await window.workbench.invoke("database.recovery.list", {
                projectId,
              })
            ).some((r) => r.consoleId === consoleId && r.revision === revision),
          { projectId: project.id, consoleId: doc.id, revision: held.revision },
        );
        const durableRecovery = JSON.parse(
          await fs.readFile(
            path.join(temp, "desktop/database/state.json"),
            "utf8",
          ),
        ).recoveries;
        assert(
          durableRecovery.some(
            (r) =>
              r.consoleId === doc.id &&
              r.revision === held.revision &&
              r.sql === "SELECT 100 AS first_window_draft;",
          ),
          "The first window's exact conflicting SQL was not durably retained",
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
              c.title === "SQL A · копия" &&
              c.sql.includes("first_window_draft"),
          ),
          "Conflict draft copy was not saved",
        );
        await second.close();
      } finally {
        await app.evaluate(({ ipcMain }) => {
          const gate = globalThis.__databaseConflictBarrier;
          if (!gate) return;
          gate.released = true;
          gate.release?.();
          ipcMain.removeHandler("workbench:invoke");
          ipcMain.handle("workbench:invoke", gate.original);
          delete globalThis.__databaseConflictBarrier;
        });
      }
    },
  );
  await check(
    "Retargeting a disconnected connection labels old documents as previous-server snapshots and prevents execution",
    async () => {
      const state = await invoke("database.snapshot", {
        projectId: project.id,
      });
      for (const doc of state.consoles.filter((c) => c.leaseId)) {
        await invoke("database.console.disconnect", {
          projectId: project.id,
          consoleId: doc.id,
        });
      }
      await p.getByRole("tab", { name: "SQL A", exact: true }).click();
      await invoke("database.connection.save", {
        connection: { ...connection, database: "template1" },
      });
      await p
        .locator(".db-link-state")
        .filter({ hasText: "Прежний сервер" })
        .waitFor();
      assert(
        (await p.locator(".db-effect").innerText()).includes(
          "относятся к прежнему серверу",
        ),
        "Cached rows were presented without their previous-server identity",
      );
      assert(
        await p
          .getByRole("button", { name: "Выполнить", exact: true })
          .isDisabled(),
        "Previous-server SQL document allowed execution against the new target",
      );
      assert(
        !(await p.locator(".db-link-state").getAttribute("class"))
          .split(/\s+/)
          .includes("connected"),
        "Previous-server document kept the green connected indicator",
      );
      let rejection = "";
      try {
        await invoke("database.console.open", {
          projectId: project.id,
          consoleId: console.id,
        });
      } catch (error) {
        rejection = error.message;
      }
      assert(
        rejection.includes("прежнему серверу"),
        "Backend silently rebound the old console to a different database",
      );
      // Restore the fixture's target without opening a new session. Old SQL/results remain readable.
      await invoke("database.connection.save", { connection });
      await p.waitForFunction(
        () =>
          document.querySelector(".db-link-state")?.textContent?.trim() !==
          "Прежний сервер",
      );
      assert(
        (await p.locator(".db-error").count()) === 0,
        "Retargeting produced an unexpected renderer error",
      );
    },
  );
  await check(
    "Native window close awaits the last SQL keystrokes before destroying renderer",
    async () => {
      const opened = app.waitForEvent("window");
      await invoke("window.new");
      const second = await opened;
      await second.waitForFunction(() => Boolean(window.workbench));
      await second
        .locator(".task-select")
        .filter({ hasText: "Live database workflow" })
        .click();
      if (!(await second.locator(".database-workspace").count()))
        await second
          .getByRole("button", { name: "Базы данных", exact: true })
          .click();
      const doc = await second.evaluate(
        ({ projectId, connectionId }) =>
          window.workbench.invoke("database.console.create", {
            projectId,
            connectionId,
            title: "Native close draft",
            sql: "SELECT 1;",
          }),
        { projectId: project.id, connectionId: connection.id },
      );
      await second
        .getByRole("tab", { name: "Native close draft", exact: true })
        .click();
      await second.getByRole("textbox", { name: "SQL редактор" }).click();
      await second.keyboard.press("ControlOrMeta+A");
      await second.keyboard.insertText("SELECT 789 AS native_close_saved;");
      const closed = second.waitForEvent("close");
      await second.evaluate(() => window.workbench.invoke("window.close"));
      await closed;
      const persisted = await invoke("database.console.read", {
        projectId: project.id,
        consoleId: doc.id,
      });
      assert(
        persisted.sql === "SELECT 789 AS native_close_saved;",
        "Native close destroyed unsaved SQL draft",
      );
    },
  );
  await check(
    "Native Close and application Quit preserve an active manual transaction until explicit Rollback",
    async () => {
      const original = (
        await admin.query("SELECT note FROM desktop_data WHERE id=1")
      ).rows[0].note;
      const doc = await invoke("database.console.create", {
        projectId: project.id,
        connectionId: connection.id,
        title: "Manual quit guard",
        sql: "SELECT 1;",
      });
      const scope = { projectId: project.id, consoleId: doc.id };
      await invoke("database.console.open", scope);
      await invoke("database.transaction", {
        ...scope,
        action: "mode",
        mode: "manual",
      });
      const write = await invoke("database.execute", {
        ...scope,
        sql: "UPDATE desktop_data SET note='private before quit' WHERE id=1",
        operationId: crypto.randomUUID(),
      });
      await waitForHost(
        p,
        async ({ projectId, jobId }) =>
          (
            await window.workbench.invoke("database.snapshot", { projectId })
          ).jobs.some((j) => j.id === jobId && j.status === "completed"),
        { projectId: project.id, jobId: write.id },
      );
      await p
        .getByRole("tab", { name: "Manual quit guard", exact: true })
        .click();
      await invoke("window.close");
      await p.locator(".error-toast").filter({ hasText: "Commit" }).waitFor();
      assert(
        !p.isClosed(),
        "Native Close destroyed the last window before checking transaction",
      );
      await p
        .getByRole("button", { name: "Закрыть сообщение", exact: true })
        .click();
      // Send from the actual prepareClose event, before this renderer sends its
      // readyToClose acknowledgement. Calling executeJavaScript after app.quit
      // can arrive after a fast, correctly rejected preflight has already ended.
      await p.evaluate(() => {
        window.closeWindowProbe = new Promise((resolve) => {
          const off = window.workbench.subscribe((event) => {
            if (event.type !== "window.prepareClose") return;
            off();
            window.workbench.invoke("window.new").then(
              () => resolve(false),
              () => resolve(true),
            );
          });
        });
      });
      await app.evaluate(({ app }) => app.quit());
      const newWindowBlocked = await p.evaluate(() => window.closeWindowProbe);
      await p.evaluate(() => delete window.closeWindowProbe);
      assert(
        newWindowBlocked,
        "A new window bypassed the global shutdown save barrier",
      );
      await p.locator(".error-toast").filter({ hasText: "Commit" }).waitFor();
      assert(
        !p.isClosed(),
        "Application quit rolled back a manual transaction without warning",
      );
      assert(
        (await admin.query("SELECT note FROM desktop_data WHERE id=1")).rows[0]
          .note === original,
        "Manual write unexpectedly committed",
      );
      const read = await invoke("database.execute", {
        ...scope,
        sql: "SELECT note FROM desktop_data WHERE id=1",
        operationId: crypto.randomUUID(),
      });
      await waitForHost(
        p,
        async ({ projectId, jobId }) =>
          (
            await window.workbench.invoke("database.snapshot", { projectId })
          ).jobs.some((j) => j.id === jobId && j.status === "completed"),
        { projectId: project.id, jobId: read.id },
      );
      const state = await invoke("database.snapshot", {
        projectId: project.id,
      });
      const result = state.jobs.find((j) => j.id === read.id).results[0];
      assert(
        (await invoke("database.page", { ...scope, resultId: result.id }))
          .values[0][0] === "private before quit",
        "Rejected shutdown still rolled back the actual PostgreSQL session",
      );
      await invoke("database.transaction", { ...scope, action: "rollback" });
      await p
        .getByRole("button", { name: "Закрыть сообщение", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Закрыть Manual quit guard", exact: true })
        .click();
    },
  );
  assert(errors.length === 0, "Renderer errors: " + errors.join("; "));
  assert(
    (await p.locator(".db-error").count()) === 0,
    "The final workspace contains an unexpected error",
  );
  await check(
    "Repeated application Quit cannot bypass the final durable SQL save",
    async () => {
      const doc = await invoke("database.console.create", {
        projectId: project.id,
        connectionId: connection.id,
        title: "Repeated quit draft",
        sql: "SELECT 1;",
      });
      await p
        .getByRole("tab", { name: "Repeated quit draft", exact: true })
        .click();
      await p.getByRole("textbox", { name: "SQL редактор" }).click();
      await p.keyboard.press("ControlOrMeta+A");
      await p.keyboard.insertText("SELECT 909 AS repeated_quit_saved;");
      const closed = app.waitForEvent("close");
      await app.evaluate(({ app }) => {
        setTimeout(() => {
          app.quit();
          app.quit();
        }, 0);
      });
      await closed;
      app = undefined;
      const persisted = JSON.parse(
        await fs.readFile(
          path.join(temp, "desktop/database/state.json"),
          "utf8",
        ),
      );
      assert(
        persisted.consoles.find((c) => c.id === doc.id)?.sql ===
          "SELECT 909 AS repeated_quit_saved;",
        "Second Quit bypassed the pending renderer persistence barrier",
      );
    },
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
      runtime,
      scope:
        "Real Electron renderer/IPC/stdio MCP/PostgreSQL, isolated cluster. No workplace MCP, GigaCode fork, VARM or unsupported platform claim.",
    },
  );
} catch (error) {
  console.error("DB UI FAILURE", error);
  if (app) {
    const page = await app.firstWindow();
    console.error(
      "DB UI DIAGNOSTIC",
      {
        errors,
        html: await page.locator(".db-main").evaluate((e) =>
          Array.from(e.children).map((c) => ({
            tag: c.tagName,
            cls: c.className,
            text: c.textContent.slice(0, 180),
          })),
        ),
      },
      await page.locator(".database-workspace").innerText(),
    );
    const diagnostic = path.join(root, "test-results/database");
    await fs.mkdir(diagnostic, { recursive: true });
    await page.screenshot({
      path: path.join(diagnostic, "database-ui-failure.png"),
    });
    // This process and database belong solely to this disposable test. A failed
    // assertion can leave a manual transaction open, so normal Quit must refuse
    // shutdown. Force only this test-owned process after collecting diagnostics.
    await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
    app = undefined;
  }
  throw error;
} finally {
  await app?.close();
  await admin.end();
}
