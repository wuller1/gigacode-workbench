import { describe, expect, it } from "vitest";
import path from "node:path";
import { applicationDataDirectory } from "../electron/application-identity";

describe("application rename preserves Workbench data", () => {
  const base = {
    appData: path.resolve("appdata"),
    previousDefault: path.resolve("old-default"),
  };
  it("reuses existing Workbench history instead of starting empty", () => {
    const legacy = path.join(base.appData, "GigaCode Workbench");
    expect(
      applicationDataDirectory({ ...base, hasState: (p) => p === legacy }),
    ).toBe(legacy);
  });
  it("does not merge two stores or override the chosen new store", () => {
    expect(applicationDataDirectory({ ...base, hasState: () => true })).toBe(
      path.join(base.appData, "GigaCode"),
    );
  });
  it("honours the explicit test/workplace data directory", () => {
    expect(
      applicationDataDirectory({
        ...base,
        override: "explicit-data",
        hasState: () => true,
      }),
    ).toBe(path.resolve("explicit-data"));
  });
});
