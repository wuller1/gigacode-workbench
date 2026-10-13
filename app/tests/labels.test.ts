import { describe, expect, it } from "vitest";
import { profileName } from "../src/labels";

describe("profile labels", () => {
  it.each([
    ["architect", "Архитектор"],
    ["database", "Разработчик БД"],
    ["designer", "Дизайнер"],
    ["security", "Безопасность"],
    ["technical-writer", "Технический писатель"],
  ])("localizes the built-in %s profile", (id, expected) => {
    expect(profileName({ id, name: id, builtin: true })).toBe(expected);
  });
});
