/** Actual shipped Electron App, real private upstream services. No replacement renderer or API. */
import assert from "node:assert/strict";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { _electron } from "playwright";
import { bounded, until } from "../../tools/ops-test-servers.mjs";
const require = createRequire(import.meta.url);
export const loadedFixtureHash = createHash("sha256")
  .update(await fs.readFile(new URL(import.meta.url)))
  .digest("hex");

async function delayProxy(base) {
  let gate;
  const observed = [];
  const origin = new URL(base);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin.origin)
        throw new Error("Test proxy target mismatch");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 ** 2)
          throw new Error("Test proxy request exceeded cap");
        chunks.push(chunk);
      }
      // Forward the public test origin explicitly. Node fetch supplies the
      // upstream Host; Jenkins uses these standard proxy headers to generate
      // its own canonical queue Location. No response Location is rewritten.
      const headers = { ...req.headers };
      delete headers["content-length"];
      headers["x-forwarded-host"] = `127.0.0.1:${server.address().port}`;
      headers["x-forwarded-port"] = String(server.address().port);
      headers["x-forwarded-proto"] = "http";
      const response = await fetch(url, {
        method: req.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 8 * 1024 ** 2)
        throw new Error("Test proxy response exceeded cap");
      observed.push({
        method: req.method,
        path: url.pathname,
        status: response.status,
      });
      if (observed.length > 1000) observed.shift();
      if (gate?.path === url.pathname) {
        const active = gate;
        gate = undefined;
        active.started();
        await active.wait;
        active.delivered();
      }
      const outgoing = Object.fromEntries(response.headers);
      delete outgoing["content-encoding"];
      delete outgoing["transfer-encoding"];
      outgoing["content-length"] = String(body.length);
      res.writeHead(response.status, outgoing);
      res.end(body);
    } catch {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Owned delay proxy failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const gates = [];
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    observed,
    hold(path) {
      let started, release, delivered;
      const result = {
        started: new Promise((r) => (started = r)),
        delivered: new Promise((r) => (delivered = r)),
      };
      gate = {
        path,
        started,
        delivered,
        wait: new Promise((r) => (release = r)),
      };
      result.release = release;
      gates.push(release);
      return result;
    },
    async close() {
      for (const release of gates) release();
      server.closeAllConnections();
      await bounded(
        new Promise((resolve) => server.close(resolve)),
        3000,
        "Owned proxy cleanup",
      );
    },
  };
}

export async function runOperationsUi({
  root,
  directory,
  servers,
  secondary,
  packaged = false,
}) {
  if (packaged && process.platform !== "win32")
    throw new Error(
      "Packaged Operations acceptance requires the Windows unpacked application",
    );
  const suffix = process.platform + (packaged ? "-packaged" : "");
  const executable = packaged
    ? path.join(root, "release/win-unpacked/GigaCode.exe")
    : require("electron");
  const cases = [],
    errors = [],
    screenshots = [];
  const artifactHashes = {};
  const hashFile = async (file) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  };
  const files = async (directory) => {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(name)));
      else if (/\.(?:js|cjs|css|html)$/.test(name)) result.push(name);
    }
    return result;
  };
  for (const file of packaged
    ? [executable, path.join(root, "release/win-unpacked/resources/app.asar")]
    : [
        ...(await files(path.join(root, "dist"))),
        ...(await files(path.join(root, "dist-electron"))),
      ])
    artifactHashes[path.relative(root, file)] = await hashFile(file);
  const output = path.join(root, "test-results/operations");
  await fs.mkdir(output, { recursive: true });
  const iterationOutput = path.join(directory, "ui");
  await fs.mkdir(iterationOutput, { recursive: true });
  let app,
    page,
    proxy,
    current = "actual App startup",
    failure;
  let rejectRenderer;
  const rendererFailure = new Promise((_, reject) => {
    rejectRenderer = reject;
  });
  // React's ErrorBoundary catches render exceptions, so Playwright's pageerror
  // alone misses a completely unusable workspace. Preserve the actual console
  // error and stop the current scenario instead of reporting a selector timeout.
  rendererFailure.catch(() => {});
  const recordRendererError = (message) => {
    errors.push(message);
    rejectRenderer(new Error("Actual renderer failure: " + message));
  };
  const check = async (name, action) => {
    current = name;
    await Promise.race([action(), rendererFailure]);
    cases.push(name);
    console.log("PASS UI " + name);
  };
  const env = {
    ...process.env,
    WORKBENCH_DATA_DIR: path.join(directory, "electron-userdata"),
    WORKBENCH_CLI_PATH: path.join(root, "tests/fixtures/acp-fixture.mjs"),
  };
  for (const key of Object.keys(env))
    if (
      /OPENAI|OPENROUTER|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(
        key,
      )
    )
      delete env[key];
  try {
    app = await _electron.launch({
      executablePath: executable,
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) =>
      recordRendererError(String(error.stack || error)),
    );
    page.on("console", (message) => {
      if (message.type() === "error") recordRendererError(message.text());
    });
    page.on("crash", () => recordRendererError("Renderer process crashed"));
    await page.waitForFunction(() => Boolean(window.workbench));
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ width: 1440, height: 940 });
      win.showInactive();
    });
    const invoke = (method, params = {}) =>
      page.evaluate(
        ({ method, params }) => window.workbench.invoke(method, params),
        { method, params },
      );
    const fence = (connection) => ({
      connectionId: connection.id,
      expectedTargetHash: connection.targetHash,
      expectedAuthGeneration: connection.authGeneration,
    });
    const createProject = async (name) => {
      const projectPath = path.join(directory, name);
      await fs.mkdir(projectPath);
      const project = await invoke("project.create", {
        name,
        path: projectPath,
      });
      const task = await invoke("task.create", {
        projectId: project.id,
        title: name + " task",
      });
      const session = await invoke("session.create", {
        taskId: task.id,
        title: "Operations assistant",
      });
      return { project, task, session };
    };
    const first = await createProject("Operations Alpha"),
      second = await createProject("Operations Beta");
    const selectProject = async (data) => {
      await page
        .locator(".task-select")
        .filter({ hasText: data.task.title })
        .click();
    };
    await selectProject(first);
    proxy = await delayProxy(servers.jenkins.base);
    const primary = await invoke("ops.connection.save", {
      connection: {
        kind: "jenkins",
        name: "Shared Jenkins",
        environment: "CI Alpha",
        enabled: true,
        projectIds: [first.project.id, second.project.id],
        transport: "builtin",
        url: proxy.base,
        username: servers.jenkins.username,
      },
      secret: servers.jenkins.token,
    });
    const alternative = await invoke("ops.connection.save", {
      connection: {
        kind: "jenkins",
        name: "Independent Jenkins",
        environment: "CI Beta",
        enabled: true,
        projectIds: [second.project.id],
        transport: "builtin",
        url: secondary.base,
        username: secondary.username,
      },
      secret: secondary.token,
    });
    for (const c of [primary, alternative])
      await invoke("ops.connection.probe", fence(c));
    const rail = page.getByRole("complementary", { name: "Рабочие панели" });
    // The workspace dock and its content have separate accessible regions;
    // scope assertions to the actual tool, never to both nested containers.
    const jenkins = page.locator('section.ops-panel[aria-label="Jenkins"]');
    const clusterPanel = page.locator(
      'section.ops-panel[aria-label="Kubernetes и OpenShift"]',
    );
    const screenshot = async (name, theme) => {
      await invoke("settings.update", { patch: { theme } });
      await page.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      const file = path.join(
        output,
        `operations-${name}-${theme}-${suffix}.png`,
      );
      const bytes = await bounded(
        page.screenshot({ path: file }),
        10000,
        "Actual Operations pixels",
      );
      assert.ok(bytes.length > 5000, "Screenshot is empty");
      await fs.writeFile(path.join(iterationOutput, path.basename(file)), bytes);
      screenshots.push(file);
    };
    await check(
      "Actual App opens Jenkins and discovers its real root catalog",
      async () => {
        await rail
          .getByRole("button", { name: "Jenkins", exact: true })
          .click();
        await rail.getByRole("button", { name: "Чат", exact: true }).click();
        await jenkins
          .getByRole("table", { name: "Джобы Jenkins" })
          .getByRole("button", { name: "Team", exact: true })
          .waitFor();
        assert.equal(
          await jenkins.getByLabel("Подключение Jenkins").inputValue(),
          primary.id,
        );
        assert.equal(
          await jenkins
            .getByLabel("Подключение Jenkins")
            .locator("option")
            .count(),
          2,
        ); // placeholder + one project-bound instance
      },
    );
    await check(
      "Folder navigation and favorite filtering include nested real jobs",
      async () => {
        await jenkins
          .getByRole("button", { name: "Team", exact: true })
          .click();
        await jenkins
          .getByRole("button", { name: "В избранное: Team/Build", exact: true })
          .click();
        await jenkins.getByRole("button", { name: /Избранные ·/ }).click();
        await jenkins
          .getByRole("table", { name: "Джобы Jenkins" })
          .getByRole("button", { name: "Build", exact: true })
          .waitFor();
        assert.equal(await jenkins.locator(".ops-table tbody tr").count(), 1);
        await jenkins
          .getByRole("button", { name: "Build", exact: true })
          .click();
        await jenkins.getByLabel("message").waitFor();
      },
    );
    let uiBuild;
    await check(
      "Real parameter form runs once and screen updates without a refresh click",
      async () => {
        const before = (
          await servers.jenkins.request(
            "job/Team/job/Build/api/json?tree=builds[number]",
          )
        ).value.builds.length;
        await jenkins.getByLabel("message").fill("UI_ACTUAL_PARAMETER");
        await jenkins.getByLabel("fast").uncheck();
        await jenkins.getByLabel("mode").selectOption("two");
        await jenkins
          .getByRole("button", { name: "Запустить", exact: true })
          .click();
        uiBuild = before + 1;
        await page.waitForFunction(
          (number) =>
            document
              .querySelector(
                '.ops-panel[aria-label="Jenkins"] .ops-history-list li:first-child',
              )
              ?.textContent.includes("#" + number),
          uiBuild,
          { timeout: 20000 },
        );
        await jenkins
          .locator(".ops-history-list li:first-child button")
          .click();
        await jenkins
          .getByLabel(`Лог Jenkins Team/Build #${uiBuild}`)
          .filter({ hasText: "UI_ACTUAL_PARAMETER" })
          .waitFor();
        const actual = (
          await servers.jenkins.request(
            `job/Team/job/Build/${uiBuild}/api/json?tree=result,building,actions[parameters[name,value]]`,
          )
        ).value;
        assert.equal(actual.result, "SUCCESS");
        const params = actual.actions.flatMap((a) => a.parameters || []);
        assert.equal(
          params.find((p) => p.name === "message").value,
          "UI_ACTUAL_PARAMETER",
        );
        assert.equal(params.find((p) => p.name === "fast").value, false);
      },
    );
    await check(
      "Completed Jenkins build refreshes its catalog row and confirms its receipt without clicks",
      async () => {
        const row = jenkins
          .getByRole("table", { name: "Джобы Jenkins" })
          .locator("tbody tr")
          .filter({ hasText: "Team/Build" });
        await until(
          async () => {
            const text = await row.innerText();
            return (
              new RegExp("#" + uiBuild + "\\b").test(text) &&
              !text.includes("в очереди")
            );
          },
          { label: "Actual completed build in master catalog", timeout: 18000 },
        );
        await until(
          async () => {
            const snapshot = await invoke("ops.snapshot");
            const receipt = snapshot.receipts.find(
              (r) =>
                r.connectionId === primary.id &&
                r.operation === "ci.trigger" &&
                r.input?.jobId === "Team/Build",
            );
            if (receipt?.status === "unknown")
              throw Object.assign(
                new Error(
                  "Actual UI trigger receipt is unknown: " +
                    receipt.error?.message,
                ),
                { fatal: true },
              );
            return (
              receipt?.status === "confirmed" &&
              receipt.data?.number === uiBuild
            );
          },
          { label: "Actual UI trigger confirmed receipt", timeout: 18000 },
        );
        const log = await jenkins
          .getByLabel(`Лог Jenkins Team/Build #${uiBuild}`)
          .innerText();
        assert.doesNotMatch(log, /ha:[A-Za-z0-9+/=]{32}/);
        assert.match(log, /Started by user/);
        assert.match(log, /UI_ACTUAL_PARAMETER/);
      },
    );
    await check(
      "Jenkins test and stage tabs read the actual APIs and report absent plugins explicitly",
      async () => {
        for (const [tab, suffix, message] of [
          [
            "Тесты",
            "testReport/api/json",
            /JUnit\/test-report API этой сборки недоступен/,
          ],
          [
            "Этапы",
            "wfapi/describe",
            /Pipeline stage API\/plugin не обнаружен/,
          ],
        ]) {
          const route = `/job/Team/job/Build/${uiBuild}/${suffix}`;
          const before = proxy.observed.filter(
            (r) => r.method === "GET" && r.path === route,
          ).length;
          await jenkins.getByRole("tab", { name: tab, exact: true }).click();
          await jenkins.getByText(message).waitFor();
          assert.ok(
            proxy.observed.filter(
              (r) =>
                r.method === "GET" && r.path === route && r.status === 404,
            ).length > before,
            "UI did not read the actual absent-plugin endpoint: " + route,
          );
          assert.equal(
            await jenkins
              .getByText(
                /MCP не обнаружил API этапов pipeline|Текущий binding не предоставляет ci\./,
              )
              .count(),
            0,
          );
        }
        await jenkins.getByRole("tab", { name: "Лог", exact: true }).click();
        await jenkins
          .getByLabel(`Лог Jenkins Team/Build #${uiBuild}`)
          .filter({ hasText: "UI_ACTUAL_PARAMETER" })
          .waitFor();
      },
    );
    await check(
      "Actual desktop Jenkins dark and light screenshots preserve usable controls",
      async () => {
        await screenshot("jenkins", "dark");
        await screenshot("jenkins", "light");
        assert.ok(
          await jenkins
            .getByRole("button", { name: "Прочитать следующую порцию лога" })
            .isVisible(),
        );
        const bounds = await jenkins.boundingBox();
        assert.ok(bounds.width > 800 && bounds.height > 500);
      },
    );
    await check(
      "Switching projects and independent CI does not retain the old job or log",
      async () => {
        await selectProject(second);
        await jenkins
          .getByLabel("Подключение Jenkins")
          .selectOption(alternative.id);
        await jenkins
          .getByRole("button", { name: "Team", exact: true })
          .waitFor();
        assert.equal(await jenkins.locator(".ops-detail").count(), 0);
        assert.ok(!(await jenkins.innerText()).includes("UI_ACTUAL_PARAMETER"));
        await selectProject(first);
        await jenkins
          .getByRole("button", { name: "Build", exact: true })
          .waitFor();
        assert.equal(
          await jenkins.getByLabel("Подключение Jenkins").inputValue(),
          primary.id,
        );
        await jenkins
          .getByRole("button", { name: "Build", exact: true })
          .click();
      },
    );
    await check(
      "Discussing an actual job preserves composer draft and selected session",
      async () => {
        await rail.getByRole("button", { name: "Чат", exact: true }).click();
        const composer = page.getByRole("textbox", {
          name: "Сообщение агенту",
          exact: true,
        });
        await composer.fill("KEEP_EXISTING_DRAFT");
        await jenkins
          .getByRole("button", {
            name: "Обсудить джобу с агентом",
            exact: true,
          })
          .click();
        const text = await composer.inputValue();
        assert.match(text, /KEEP_EXISTING_DRAFT/);
        assert.match(text, /Team\/Build/);
        const state = await invoke("state.get");
        assert.equal(
          state.sessions.find((s) => s.id === first.session.id).messages.length,
          0,
          "Discuss unexpectedly sent a model prompt",
        );
        await rail.getByRole("button", { name: "Чат", exact: true }).click();
      },
    );
    await check(
      "Host reveal opens an exact real job instead of just the generic panel",
      async () => {
        await invoke("ops.reveal", {
          projectId: first.project.id,
          connectionId: primary.id,
          jobId: "Team/Build",
          number: uiBuild,
        });
        await jenkins
          .getByLabel(`Лог Jenkins Team/Build #${uiBuild}`)
          .filter({ hasText: "UI_ACTUAL_PARAMETER" })
          .waitFor();
      },
    );
    await check(
      "A delayed same-connection reveal cannot override a newer manual selection",
      async () => {
        await jenkins.getByRole("button", { name: /Избранные ·/ }).click();
        await jenkins
          .getByRole("button", { name: "Корень", exact: true })
          .click();
        await jenkins
          .getByRole("table", { name: "Джобы Jenkins" })
          .getByRole("button", { name: "Hold", exact: true })
          .click();
        await invoke("ops.query", {
          projectId: first.project.id,
          ...fence(primary),
          operation: "ci.job",
          input: { jobId: "Hold" },
        });
        const held = proxy.hold("/job/Team/job/Build/api/json");
        await invoke("ops.reveal", {
          projectId: first.project.id,
          connectionId: primary.id,
          jobId: "Team/Build",
        });
        await bounded(held.started, 10000, "Actual old reveal response");
        await jenkins
          .getByRole("table", { name: "Джобы Jenkins" })
          .getByRole("button", { name: "Hold", exact: true })
          .click();
        held.release();
        await bounded(held.delivered, 3000, "Delayed real response delivery");
        await invoke("ops.query", {
          projectId: first.project.id,
          ...fence(primary),
          operation: "ci.job",
          input: { jobId: "Hold" },
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert.equal(
          await jenkins.locator(".ops-detail-head strong").innerText(),
          "Hold",
        );
      },
    );
    await check(
      "Actual App stops its running Jenkins build and updates to ABORTED without refresh",
      async () => {
        const before = (
          await servers.jenkins.request("job/Hold/api/json?tree=builds[number]")
        ).value.builds.length;
        await jenkins
          .getByRole("button", { name: "Запустить", exact: true })
          .click();
        const number = before + 1;
        await page.waitForFunction(
          (n) =>
            document
              .querySelector(
                '.ops-panel[aria-label="Jenkins"] .ops-history-list li:first-child',
              )
              ?.textContent.includes("#" + n),
          number,
          { timeout: 20000 },
        );
        await jenkins
          .locator(".ops-history-list li:first-child button")
          .click();
        await jenkins
          .getByRole("button", { name: "Остановить сборку", exact: true })
          .click();
        await jenkins
          .locator(".ops-detail .ops-code-tools")
          .first()
          .getByText("Остановлено", { exact: true })
          .waitFor({ timeout: 15000 });
        assert.equal(
          (
            await servers.jenkins.request(
              `job/Hold/${number}/api/json?tree=result,building`,
            )
          ).value.result,
          "ABORTED",
        );
      },
    );
    if (servers.cluster) {
      const cluster = servers.cluster,
        ns = "workbench-ui";
      await cluster.request("api/v1/namespaces", {
        method: "POST",
        body: { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } },
      });
      const route = `api/v1/namespaces/${ns}/configmaps/ui-editor`;
      await cluster.request(route + "?fieldManager=gigacode-workbench", {
        method: "PATCH",
        headers: { "Content-Type": "application/apply-patch+yaml" },
        body: {
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: "ui-editor", namespace: ns },
          data: { value: "before" },
        },
      });
      const connection = await invoke("ops.connection.save", {
        connection: {
          kind: "kubernetes",
          name: "Shared cluster",
          environment: "My integration stand",
          enabled: true,
          projectIds: [first.project.id, second.project.id],
          transport: "builtin",
          url: cluster.base,
          ca: cluster.ca,
        },
        secret: cluster.adminToken,
      });
      await invoke("ops.connection.probe", fence(connection));
      const chooseConfigMaps = async () => {
        const showKinds = clusterPanel.getByRole("button", {
          name: "Показать виды ресурсов",
          exact: true,
        });
        if (await showKinds.isVisible()) await showKinds.click();
        const button = clusterPanel.locator('[title="core/v1 · configmaps"]');
        await button.waitFor({ state: "attached" });
        if (!(await button.evaluate((e) => e.closest("details").open)))
          await button.locator("..").locator("summary").click();
        await button.click();
      };
      const openObject = async () => {
        await clusterPanel
          .getByRole("table", { name: "Ресурсы ConfigMap" })
          .getByRole("button", { name: "ui-editor", exact: true })
          .click();
      };
      const yaml = () =>
        clusterPanel.getByRole("textbox", {
          name: "YAML ресурса Kubernetes",
          exact: true,
        });
      await check(
        "Actual Kubernetes panel selects a namespace and true ConfigMap identities",
        async () => {
          await rail
            .getByRole("button", {
              name: "Kubernetes / OpenShift",
              exact: true,
            })
            .click();
          await chooseConfigMaps();
          await clusterPanel.getByLabel("Namespace", { exact: true }).fill(ns);
          await clusterPanel
            .getByLabel("Namespace", { exact: true })
            .press("Enter");
          await openObject();
          await clusterPanel
            .getByRole("tab", { name: "YAML", exact: true })
            .click();
          await yaml().waitFor();
          assert.match(await yaml().innerText(), /ui-editor/);
        },
      );
      await check(
        "Actual YAML editor preserves a dirty draft through external update and blocks stale Apply",
        async () => {
          await clusterPanel
            .getByRole("button", { name: "Редактировать", exact: true })
            .click();
          const text = (await yaml().innerText()).replace(
            "value: before",
            "value: UI_DIRTY_DRAFT",
          );
          assert.match(text, /UI_DIRTY_DRAFT/);
          await yaml().fill(text);
          await cluster.request(route, {
            method: "PATCH",
            headers: { "Content-Type": "application/merge-patch+json" },
            body: { metadata: { annotations: { external: "changed" } } },
          });
          await clusterPanel
            .getByText(/Серверная версия изменилась/)
            .waitFor({ timeout: 18000 });
          assert.match(await yaml().innerText(), /UI_DIRTY_DRAFT/);
          assert.equal(
            await clusterPanel
              .getByRole("button", {
                name: "Проверить и применить",
                exact: true,
              })
              .isDisabled(),
            true,
          );
          assert.equal(
            (await cluster.request(route)).value.data.value,
            "before",
          );
        },
      );
      await check(
        "Closing and reopening resource details restores the exact unsaved YAML",
        async () => {
          const text = await yaml().innerText();
          await clusterPanel
            .getByRole("button", {
              name: "Закрыть сведения о ресурсе, сохранив черновик",
              exact: true,
            })
            .click();
          await openObject();
          await clusterPanel
            .getByRole("tab", { name: "YAML", exact: true })
            .click();
          assert.equal(await yaml().innerText(), text);
        },
      );
      await check(
        "Desktop split panels keep YAML actions in bounds at 1440 and 1024 and restore their dirty editor after maximize",
        async () => {
          const draft = await yaml().innerText();
          const clusterHeader = page
            .locator(".desktop-dock-header")
            .filter({
              has: page.getByRole("tab", {
                name: "Kubernetes / OpenShift",
                exact: true,
              }),
            });
          const inPanel = async (panel, control) => {
            assert.ok(await control.isVisible(), "Desktop control is hidden");
            const parent = await panel.boundingBox(),
              child = await control.boundingBox();
            assert.ok(
              child.x >= parent.x - 1 &&
                child.x + child.width <= parent.x + parent.width + 1 &&
                child.y >= parent.y - 1 &&
                child.y + child.height <= parent.y + parent.height + 1,
              "Desktop control is clipped: " +
                JSON.stringify({ parent, child }),
            );
          };
          for (const width of [1440, 1024]) {
            await app.evaluate(({ BrowserWindow }, width) => {
              BrowserWindow.getAllWindows()[0].setBounds({
                width,
                height: 940,
              });
            }, width);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            const viewport = await page.evaluate(() => innerWidth);
            assert.ok(Math.abs(viewport - width) <= 2);
            for (const panel of [jenkins, clusterPanel]) {
              const box = await panel.boundingBox();
              assert.ok(box.x >= 0 && box.x + box.width <= viewport + 1);
              const geometry = await panel.evaluate((element) => ({
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
              }));
              assert.ok(
                geometry.scrollWidth <= geometry.width + 1,
                "Whole Operations panel overflows at desktop width " +
                  width +
                  ": " +
                  JSON.stringify(geometry),
              );
            }
            await inPanel(clusterPanel, clusterPanel.locator(".cm-editor"));
            await inPanel(
              clusterPanel,
              clusterPanel.getByRole("button", {
                name: "Проверить и применить",
                exact: true,
              }),
            );
            const backToList = clusterPanel.getByRole("button", {
              name: "Вернуться к списку ресурсов",
              exact: true,
            });
            if (width === 1024)
              assert.equal(await backToList.isVisible(), true);
            if (await backToList.isVisible()) {
              await backToList.click();
              assert.equal(
                await clusterPanel
                  .getByRole("table", { name: "Ресурсы ConfigMap" })
                  .getByRole("button", { name: "ui-editor", exact: true })
                  .isVisible(),
                true,
              );
              await openObject();
              assert.equal(await yaml().innerText(), draft);
            }
            const before = await clusterPanel.boundingBox();
            await clusterHeader
              .getByRole("button", { name: "Развернуть панель", exact: true })
              .click();
            await until(
              async () =>
                (await clusterPanel.boundingBox()).width > before.width * 1.5,
              { label: "Actual dock maximized geometry", timeout: 3000 },
            );
            assert.equal(await yaml().innerText(), draft);
            assert.equal(await jenkins.isVisible(), false);
            await clusterHeader
              .getByRole("button", {
                name: "Вернуть расположение",
                exact: true,
              })
              .click();
            await until(
              async () =>
                Math.abs(
                  (await clusterPanel.boundingBox()).width - before.width,
                ) < 2,
              { label: "Actual dock restored split", timeout: 3000 },
            );
            assert.equal(await yaml().innerText(), draft);
            assert.equal(await jenkins.isVisible(), true);
            if (width === 1024) await screenshot("split-1024", "dark");
          }
          await app.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setBounds({
              width: 1440,
              height: 940,
            });
          });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
        },
      );
      await check(
        "Actual desktop Kubernetes dark and light screenshots show conflict and syntax",
        async () => {
          await screenshot("cluster", "dark");
          await screenshot("cluster", "light");
          assert.ok((await clusterPanel.locator(".cm-line span").count()) > 0);
        },
      );
      await check(
        "Reloading server YAML requires an explicit choice, then actual dry-run/apply succeeds",
        async () => {
          await clusterPanel
            .getByRole("button", { name: "Загрузить свежий", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Отмена", exact: true })
            .click();
          assert.match(await yaml().innerText(), /UI_DIRTY_DRAFT/);
          await clusterPanel
            .getByRole("button", { name: "Загрузить свежий", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Подтвердить", exact: true })
            .click();
          if (
            await clusterPanel
              .getByRole("button", { name: "Редактировать", exact: true })
              .count()
          )
            await clusterPanel
              .getByRole("button", { name: "Редактировать", exact: true })
              .click();
          const text = (await yaml().innerText()).replace(
            "value: before",
            "value: UI_APPLIED",
          );
          await yaml().fill(text);
          await clusterPanel
            .getByRole("button", { name: "Проверить и применить", exact: true })
            .click();
          await clusterPanel
            .getByRole("button", { name: "Выполнить", exact: true })
            .click();
          await until(
            async () =>
              (await cluster.request(route)).value.data.value === "UI_APPLIED",
            { label: "Actual UI Kubernetes apply", timeout: 10000 },
          );
          await clusterPanel
            .getByRole("button", {
              name: "Закрыть просмотр операции",
              exact: true,
            })
            .click();
        },
      );
      await check(
        "Cross-project switching retains target-bound YAML instead of exposing another project draft",
        async () => {
          await clusterPanel
            .getByRole("button", {
              name: "Закрыть сведения о ресурсе, сохранив черновик",
              exact: true,
            })
            .click();
          await selectProject(second);
          assert.equal(await clusterPanel.locator(".ops-detail").count(), 0);
          assert.ok(
            !(await clusterPanel.innerText()).includes("UI_DIRTY_DRAFT"),
          );
          await selectProject(first);
        },
      );
      await check(
        "Cluster user labels remain editable and are updated on the live toolbar",
        async () => {
          const current = (await invoke("ops.snapshot")).connections.find(
            (c) => c.id === connection.id,
          );
          await invoke("ops.connection.save", {
            connection: { ...current, environment: "My renamed stand" },
          });
          await clusterPanel
            .getByText("My renamed stand", { exact: true })
            .waitFor();
        },
      );
      await check(
        "Actual resource creation validates and persists the exact user YAML",
        async () => {
          await chooseConfigMaps();
          await clusterPanel.getByLabel("Namespace", { exact: true }).fill(ns);
          await clusterPanel
            .getByLabel("Namespace", { exact: true })
            .press("Enter");
          await clusterPanel
            .getByRole("button", { name: "Создать", exact: true })
            .click();
          await yaml().fill(
            `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ui-created\n  namespace: ${ns}\ndata:\n  value: created-through-ui\n`,
          );
          await clusterPanel
            .getByRole("button", { name: "Проверить и создать", exact: true })
            .click();
          await clusterPanel
            .getByRole("button", { name: "Выполнить", exact: true })
            .click();
          await until(
            async () => {
              const r = await cluster.request(
                `api/v1/namespaces/${ns}/configmaps/ui-created`,
                { allowError: true },
              );
              return (
                r.status === 200 && r.value.data.value === "created-through-ui"
              );
            },
            { label: "Actual UI createOnly POST", timeout: 10000 },
          );
          await clusterPanel
            .locator(".ops-detail-head strong")
            .filter({ hasText: /^ui-created$/ })
            .waitFor();
        },
      );
      await check(
        "Host reveal locates an exact resource and retains its true UID",
        async () => {
          await invoke("ops.reveal", {
            projectId: first.project.id,
            connectionId: connection.id,
            target: {
              group: "",
              version: "v1",
              resource: "configmaps",
              namespace: ns,
              name: "ui-created",
            },
          });
          await clusterPanel
            .getByRole("tab", { name: "YAML", exact: true })
            .click();
          await yaml().waitFor();
          assert.match(await yaml().innerText(), /created-through-ui/);
          const actual = (
            await cluster.request(
              `api/v1/namespaces/${ns}/configmaps/ui-created`,
            )
          ).value;
          assert.match(
            await yaml().innerText(),
            new RegExp(actual.metadata.uid),
          );
        },
      );
      await check(
        "Create drafts with the same name in two namespaces keep separate exact contents",
        async () => {
          const otherNs = "workbench-ui-other";
          await cluster.request("api/v1/namespaces", {
            method: "POST",
            body: {
              apiVersion: "v1",
              kind: "Namespace",
              metadata: { name: otherNs },
            },
          });
          const revealCreation = (namespace) =>
            invoke("ops.reveal", {
              projectId: first.project.id,
              connectionId: connection.id,
              creation: true,
              target: {
                group: "",
                version: "v1",
                resource: "configmaps",
                namespace,
                name: "same-draft",
              },
            });
          await revealCreation(ns);
          await clusterPanel
            .getByLabel("Namespace нового ресурса", { exact: true })
            .waitFor();
          const firstDraft = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: same-draft\n  namespace: ${ns}\ndata:\n  value: NS_A_ONLY\n`;
          await yaml().fill(firstDraft);
          await revealCreation(otherNs);
          await page.waitForFunction(
            (namespace) =>
              document.querySelector('[aria-label="Namespace нового ресурса"]')
                ?.value === namespace,
            otherNs,
          );
          assert.ok(!(await yaml().innerText()).includes("NS_A_ONLY"));
          await yaml().fill(
            firstDraft.replace(ns, otherNs).replace("NS_A_ONLY", "NS_B_ONLY"),
          );
          await revealCreation(ns);
          await page.waitForFunction(
            (namespace) =>
              document.querySelector('[aria-label="Namespace нового ресурса"]')
                ?.value === namespace,
            ns,
          );
          assert.match(await yaml().innerText(), /NS_A_ONLY/);
          assert.ok(!(await yaml().innerText()).includes("NS_B_ONLY"));
          assert.equal(
            (
              await cluster.request(
                `api/v1/namespaces/${ns}/configmaps/same-draft`,
                { allowError: true },
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await cluster.request(
                `api/v1/namespaces/${otherNs}/configmaps/same-draft`,
                { allowError: true },
              )
            ).status,
            404,
          );
          await clusterPanel
            .getByRole("button", {
              name: "Закрыть создание, сохранив YAML-черновик",
              exact: true,
            })
            .click();
        },
      );
    }
    await check(
      "Actual Operations settings warns before discarding secret and CA drafts",
      async () => {
        await page
          .getByRole("button", { name: "Настройки", exact: true })
          .first()
          .click();
        await page
          .locator(".settings-nav")
          .getByRole("button", { name: "Jenkins и кластеры", exact: true })
          .click();
        const section = page.locator(".ops-settings");
        await section
          .getByRole("complementary", {
            name: "Подключения Jenkins и кластеров",
          })
          .getByRole("button", { name: /Shared Jenkins/ })
          .click();
        await section.getByLabel("Токен Operations").fill("UNSAVED_UI_TOKEN");
        await page
          .locator(".settings-footer")
          .getByRole("button", { name: "Закрыть", exact: true })
          .click();
        await page.getByRole("button", { name: "Отмена", exact: true }).click();
        assert.equal(
          await section.getByLabel("Токен Operations").inputValue(),
          "UNSAVED_UI_TOKEN",
        );
        await page
          .locator(".settings-footer")
          .getByRole("button", { name: "Закрыть", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Подтвердить", exact: true })
          .click();
      },
    );
    assert.deepEqual(errors, [], "Actual renderer raised an exception");
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(new URL(import.meta.url)))
        .digest("hex"),
      loadedFixtureHash,
      "Actual UI harness changed after Node loaded it",
    );
    for (const [file, executedHash] of Object.entries(artifactHashes))
      assert.equal(
        await hashFile(path.join(root, file)),
        executedHash,
        "Shipped artifact changed during actual App execution: " + file,
      );
  } catch (error) {
    failure = {
      test: current,
      message: String(error?.message || error),
      stack: error?.stack,
    };
    if (page)
      try {
        const pixels = await bounded(
          page.screenshot({
            path: path.join(output, `operations-failure-${suffix}.png`),
          }),
          8000,
          "Failure pixels",
        );
        await fs.writeFile(
          path.join(iterationOutput, `operations-failure-${suffix}.png`),
          pixels,
        );
      } catch {}
  } finally {
    try {
      await bounded(app?.close(), 15000, "Owned Electron cleanup");
    } catch (error) {
      failure ||= {
        test: "Owned Electron cleanup",
        message: String(error.message || error),
      };
      try {
        app?.process().kill("SIGKILL");
      } catch {}
    }
    await proxy?.close().catch((error) => {
      failure ||= {
        test: "Owned delay proxy cleanup",
        message: String(error.message || error),
      };
    });
  }
  const report = {
    suite: "operations-actual-electron",
    status: failure ? "failed" : "passed",
    platform: process.platform,
    mode: packaged
      ? "Windows unpacked application and its own provider"
      : "source application and its own provider",
    cases,
    passed: cases.length,
    screenshots,
    artifactHashes,
    loadedFixtureHash,
    faultInjection:
      "One selected real Jenkins response delayed by a private forwarding proxy; response data remains upstream",
    optionalApiReads: (proxy?.observed || []).filter(
      (r) =>
        r.method === "GET" &&
        /\/(?:testReport\/api\/json|wfapi\/describe)$/.test(r.path),
    ),
    errors,
    ...(failure ? { failure } : {}),
  };
  await fs.writeFile(
    path.join(output, `result-ui-${suffix}.json`),
    JSON.stringify(report, null, 2),
  );
  await fs.writeFile(
    path.join(iterationOutput, "result.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}
