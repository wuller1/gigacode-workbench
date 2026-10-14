import { describe, expect, it } from "vitest";
import { RendererRecoveryBudget } from "../electron/renderer-recovery";
describe("bounded recovery of a display window", () => {
  it("allows three recoveries and then stops the crash loop", () => {
    const budget = new RendererRecoveryBudget();
    expect(budget.claim(1, 1000)).toEqual({ allowed: true, attempt: 1 });
    expect(budget.claim(1, 2000).allowed).toBe(true);
    expect(budget.claim(1, 3000)).toEqual({ allowed: true, attempt: 3 });
    expect(budget.claim(1, 4000)).toEqual({ allowed: false, attempt: 3 });
    expect(budget.claim(1, 60000).allowed).toBe(false);
    expect(budget.claim(1, 63001)).toEqual({ allowed: true, attempt: 1 });
  });
  it("keeps independent windows separate and releases closed window records", () => {
    const budget = new RendererRecoveryBudget(1);
    budget.claim(1, 1000);
    expect(budget.claim(1, 1001).allowed).toBe(false);
    expect(budget.claim(2, 1001).allowed).toBe(true);
    budget.forget(1);
    expect(budget.claim(1, 1002).allowed).toBe(true);
  });
  it("does not permanently block recovery after the system clock moves backwards", () => {
    const budget = new RendererRecoveryBudget(1);
    budget.claim(1, 10000);
    expect(budget.claim(1, 10)).toEqual({ allowed: true, attempt: 1 });
  });
});
