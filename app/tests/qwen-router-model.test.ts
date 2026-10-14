import { describe, expect, it } from "vitest";
import { qwenRouterModelSelection } from "../electron/role-router.js";

describe("source-verified Qwen ACP model selection for a headless router", () => {
  it("preserves raw CLI IDs literally when there is no ACP option metadata", () => {
    expect(qwenRouterModelSelection("custom(openai)", undefined, [])).toEqual({
      model: "custom(openai)",
      authArgs: [],
    });
  });
  it("passes the wire model ID and its confirmed provider instead of an ACP display selector", () => {
    const advertised = ["vendor/model(openai)"];
    expect(
      qwenRouterModelSelection(advertised[0], advertised, [
        "--auth-type",
        "openai",
      ]),
    ).toEqual({
      model: "vendor/model",
      authArgs: ["--auth-type", "openai"],
    });
    expect(
      qwenRouterModelSelection(
        "model(revision)(openai)",
        ["model(revision)(openai)"],
        [],
      ),
    ).toEqual({
      model: "model(revision)",
      authArgs: ["--auth-type", "openai"],
    });
    expect(
      qwenRouterModelSelection(advertised[0], advertised, [
        "--auth-type=openai",
      ]),
    ).toEqual({
      model: "vendor/model",
      authArgs: ["--auth-type=openai"],
    });
  });
  it("does not guess stale, opaque, runtime or unsupported ACP routes", () => {
    expect(() =>
      qwenRouterModelSelection("stale(openai)", ["other(openai)"], []),
    ).toThrow(/advertised/);
    for (const selected of [
      "qwen-route:v1:opaque",
      "$runtime|snapshot(openai)",
      "model(unknown)",
      "unexpected raw ACP ID",
    ])
      expect(() => qwenRouterModelSelection(selected, [selected], [])).toThrow(
        /resolver|snapshot/,
      );
  });
  it("does not forward old endpoint or credential flags across an ambiguous provider switch", () => {
    const selected = "model(anthropic)";
    expect(() =>
      qwenRouterModelSelection(selected, [selected], ["--auth-type", "openai"]),
    ).toThrow(/Cross-provider/);
    expect(() =>
      qwenRouterModelSelection(
        selected,
        [selected],
        ["--openai-api-key", "synthetic-credential"],
      ),
    ).toThrow(/Cross-provider/);
    expect(() =>
      qwenRouterModelSelection(
        selected,
        [selected],
        ["--openai-base-url=https://owned.invalid"],
      ),
    ).toThrow(/Cross-provider/);
    expect(
      qwenRouterModelSelection(
        selected,
        [selected],
        ["--auth-type", "anthropic"],
      ),
    ).toEqual({
      model: "model",
      authArgs: ["--auth-type", "anthropic"],
    });
  });
});
