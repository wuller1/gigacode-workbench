import { describe, expect, it } from "vitest";
import type { AppState, Session } from "../shared/types.js";
import {
  defaultContextPolicy,
  recordRuntimeDispatch,
  recordRuntimeUsage,
  runtimeContext,
  runtimeContextDecision,
  validateRuntimeContextRecord,
} from "../electron/context-runtime.js";

function fixture() {
  const state = {
    settings: {
      cliPath: "unknown-gigacode",
      model: "flash",
      contextLimit: 256000,
    },
    questions: [],
  } as unknown as AppState;
  const session = {
    id: "s",
    model: "flash",
    reasoning: "high",
    messages: [],
    queue: [],
    status: "idle",
    context: {},
    todos: [],
  } as unknown as Session;
  const view = runtimeContext(state, session, 1, defaultContextPolicy);
  const append = (id: string, role: "user" | "assistant", content: string) =>
    session.messages.push({ id, role, content, at: new Date().toISOString() });
  return { state, session, view, append };
}

describe("generation-scoped known-byte fallback for an unverified CLI", () => {
  it("preserves the actual executor's known history and unresolved tools across a route-label edit, and drops foreign calibration evidence", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 12000,
      visibleInputBytes: 1000,
    });
    x.append("u", "user", "u".repeat(1000));
    x.append("a", "assistant", "a".repeat(1000));
    const previous = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    expect(previous.record.supervisor.latestUsage?.usedTokens).toBe(6500);
    previous.record.evidence.push({
      modelKey: previous.envelope.modelKey,
      kind: "verified_recall",
      tokens: 120000,
      at: Date.now(),
      reference: "owned:old-route-sample",
    });
    const policy = {
      ...defaultContextPolicy,
      routeKey: "new-label",
      highWaterTokens: 6000,
      lowWaterTokens: 3000,
    };
    let rebound = runtimeContext(
      x.state,
      x.session,
      1,
      policy,
      previous.record,
    );
    expect(rebound.envelope.modelKey).not.toBe(previous.envelope.modelKey);
    expect(rebound.record).toMatchObject({
      historyFromIndex: 0,
      historyBaselineBytes: 11000,
      dispatches: 1,
      historyBoundaryKnown: true,
    });
    expect(rebound.record.supervisor.latestUsage).toMatchObject({
      usedTokens: 6500,
      estimated: true,
      basis: "host_estimate",
    });
    expect(rebound.record.evidence).toEqual([]);
    expect(rebound.envelope.observedRecallTokens).toBeUndefined();
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        rebound.record,
        rebound.envelope,
        true,
      ).action,
    ).toBe("rotate_at_boundary");
    x.session.messages[1].tools = [
      { id: "unknown", title: "Uncertain native write", status: "in_progress" },
    ];
    rebound = runtimeContext(
      x.state,
      x.session,
      1,
      { ...policy, routeKey: "another-label" },
      rebound.record,
    );
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        rebound.record,
        rebound.envelope,
        true,
      ).action,
    ).toBe("hold_unknown");
    expect(previous.record.historyFromIndex).toBe(0);
    expect(previous.record.supervisor.modelKey).toBe(
      previous.envelope.modelKey,
    );
  });

  it("retains old-route measured pressure as an explicit estimate plus fresh byte growth until actual usage on the new route arrives", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 12000,
      visibleInputBytes: 1000,
    });
    x.append("u", "user", "u".repeat(1000));
    x.append("a", "assistant", "a".repeat(1000));
    const previous = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    recordRuntimeUsage(previous.record, {
      kind: "usage",
      id: "native-203k",
      at: Date.now() + 1,
      usedTokens: 203202,
      estimated: false,
      basis: "cli_usage",
    });
    x.append("growth", "assistant", "g".repeat(2000));
    let rebound = runtimeContext(
      x.state,
      x.session,
      1,
      { ...defaultContextPolicy, routeKey: "new-label" },
      previous.record,
    );
    expect(rebound.record.supervisor.latestUsage).toMatchObject({
      usedTokens: 204202,
      estimated: true,
      basis: "host_estimate",
    });
    expect(rebound.record.inheritedRoutePressure).toMatchObject({
      sourceModelKey: previous.envelope.modelKey,
      usedTokens: 204202,
      historyBytes: 15000,
    });
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        rebound.record,
        rebound.envelope,
        true,
      ).action,
    ).toBe("rotate_at_boundary");
    x.append("more", "user", "g".repeat(2000));
    rebound = runtimeContext(
      x.state,
      x.session,
      1,
      { ...defaultContextPolicy, routeKey: "third-label" },
      rebound.record,
    );
    expect(rebound.record.supervisor.latestUsage?.usedTokens).toBe(205202);
    rebound = runtimeContext(
      x.state,
      x.session,
      1,
      { ...defaultContextPolicy, routeKey: "third-label" },
      rebound.record,
    );
    expect(rebound.record.supervisor.latestUsage?.usedTokens).toBe(205202);
    expect(
      validateRuntimeContextRecord(JSON.parse(JSON.stringify(rebound.record))),
    ).toBe(true);
    recordRuntimeUsage(rebound.record, {
      kind: "usage",
      id: "new-native-actual",
      at: Date.now() + 2,
      usedTokens: 4000,
      estimated: false,
      basis: "cli_usage",
    });
    expect(rebound.record.inheritedRoutePressure).toBeUndefined();
    expect(rebound.record.supervisor.latestUsage).toMatchObject({
      usedTokens: 4000,
      estimated: false,
    });
    x.append("new-growth", "assistant", "z".repeat(2000));
    rebound = runtimeContext(
      x.state,
      x.session,
      1,
      { ...defaultContextPolicy, routeKey: "third-label" },
      rebound.record,
    );
    expect(rebound.record.hostEstimate?.usedTokens).toBe(5000);
  });

  it("preserves pressure on a same-executor model/reasoning change but resets it at a real new generation", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 12000,
      visibleInputBytes: 1000,
    });
    x.append("u", "user", "u".repeat(1000));
    let view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    x.session.model = "other-flash";
    x.session.reasoning = "low";
    view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      view.record,
    );
    expect(view.record.supervisor.latestUsage?.usedTokens).toBe(6000);
    expect(view.record.historyFromIndex).toBe(0);
    const fresh = runtimeContext(
      x.state,
      x.session,
      2,
      defaultContextPolicy,
      view.record,
    );
    expect(fresh.record.inheritedRoutePressure).toBeUndefined();
    expect(fresh.record.historyFromIndex).toBe(1);
    expect(fresh.record.historyBoundaryKnown).toBe(true);
    expect(fresh.record.supervisor.latestUsage?.usedTokens).toBe(0);
  });

  it("grows with real user, assistant and dispatched wrapper content without inventing provider limits", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 12000,
      visibleInputBytes: 10000,
    });
    x.append("u1", "user", "a".repeat(10000));
    let view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    expect(view.record.supervisor.latestUsage).toMatchObject({
      usedTokens: 6000,
      estimated: true,
      basis: "host_estimate",
    });
    x.append("a1", "assistant", "界".repeat(2000));
    view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      view.record,
    );
    expect(view.record.supervisor.latestUsage?.usedTokens).toBe(9000);
    recordRuntimeDispatch(view.record, {
      historyLength: 2,
      promptBytes: 1100,
      visibleInputBytes: 1000,
    });
    x.append("u2", "user", "b".repeat(1000));
    view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      view.record,
    );
    expect(view.record.supervisor.latestUsage?.usedTokens).toBe(9550);
    expect(view.record.evidence).toEqual([]);
    expect(view.envelope.fullContextVerified).toBe(false);
    expect(
      validateRuntimeContextRecord(JSON.parse(JSON.stringify(view.record))),
    ).toBe(true);
  });

  it("rotates to a checkpoint baseline and never re-counts retained old history in the fresh generation", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 200000,
      visibleInputBytes: 200000,
    });
    x.append("old-u", "user", "x".repeat(200000));
    const old = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    expect(
      runtimeContextDecision(x.state, x.session, old.record, old.envelope, true)
        .action,
    ).toBe("rotate_at_boundary");
    old.record.lastRotation = {
      at: new Date().toISOString(),
      beforeTokens: 100000,
      checkpointSha256: "a".repeat(64),
      checkpointBytes: 128,
    };
    let fresh = runtimeContext(
      x.state,
      x.session,
      2,
      defaultContextPolicy,
      old.record,
    );
    expect(fresh.record.historyFromIndex).toBe(1);
    expect(fresh.record.supervisor.latestUsage?.usedTokens).toBe(64);
    recordRuntimeDispatch(fresh.record, {
      historyLength: 1,
      promptBytes: 532,
      visibleInputBytes: 32,
    });
    x.append("fresh-u", "user", "y".repeat(32));
    fresh = runtimeContext(
      x.state,
      x.session,
      2,
      defaultContextPolicy,
      fresh.record,
    );
    expect(fresh.record.supervisor.latestUsage?.usedTokens).toBe(266);
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        fresh.record,
        fresh.envelope,
        true,
      ).action,
    ).toBe("continue");
    expect(x.session.messages[0].content.length).toBe(200000);
  });

  it("counts a first-generation recovery packet and hidden peer input only once without copying them into history", () => {
    const x = fixture();
    x.append("retained", "user", "r".repeat(200000));
    const recovered = runtimeContext(
      x.state,
      x.session,
      8,
      defaultContextPolicy,
    );
    recovered.record.historyBaselineBytes = 5000;
    recordRuntimeDispatch(recovered.record, {
      historyLength: 1,
      promptBytes: 9000,
      visibleInputBytes: 0,
    });
    x.append("peer-a", "assistant", "Actual peer answer");
    const observed = runtimeContext(
      x.state,
      x.session,
      8,
      defaultContextPolicy,
      recovered.record,
    );
    expect(observed.record.historyFromIndex).toBe(1);
    expect(observed.record.supervisor.latestUsage?.usedTokens).toBe(4509);
    expect(observed.record.historyBaselineBytes).toBe(9000);
  });

  it("keeps native actual usage authoritative and separately estimates known growth after that exact measurement", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 10000,
      visibleInputBytes: 10000,
    });
    x.append("u", "user", "x".repeat(10000));
    let view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    recordRuntimeUsage(view.record, {
      kind: "usage",
      id: "actual-1",
      at: Date.now() + 1,
      usedTokens: 600,
      estimated: false,
      basis: "cli_usage",
    });
    view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      view.record,
    );
    expect(view.record.supervisor.latestUsage).toMatchObject({
      id: "actual-1",
      usedTokens: 600,
      estimated: false,
    });
    x.append("a", "assistant", "y".repeat(2000));
    view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      view.record,
    );
    expect(view.record.supervisor.latestUsage?.usedTokens).toBe(600);
    expect(view.record.hostEstimate).toMatchObject({
      usedTokens: 1600,
      estimated: true,
      basis: "host_estimate",
    });
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ),
    ).toMatchObject({ usedTokens: 1600, estimated: true });
    recordRuntimeUsage(view.record, {
      kind: "usage",
      id: "estimated-late",
      at: Date.now() + 2,
      usedTokens: 9999,
      estimated: true,
      basis: "host_estimate",
    });
    expect(view.record.supervisor.latestUsage?.id).toBe("actual-1");
  });

  it("bounds arbitrary tool objects and strings without serializing cyclic tool input", () => {
    const x = fixture(),
      cyclic: any = { query: "SELECT actual", nested: {} };
    cyclic.nested.parent = cyclic;
    cyclic.large = "z".repeat(300000);
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 0,
      visibleInputBytes: 0,
    });
    x.append("a", "assistant", "Observed output");
    x.session.messages[0].tools = [
      {
        id: "t",
        title: "Query",
        status: "completed",
        input: cyclic,
        output: "q".repeat(300000),
      },
    ];
    const view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    expect(view.record.supervisor.latestUsage!.usedTokens).toBeGreaterThan(
      60000,
    );
    expect(view.record.supervisor.latestUsage!.usedTokens).toBeLessThan(70000);
  });

  it("holds after two estimated renewals leave the known prompt wrapper irreducible, but actual usage overrides that estimate", () => {
    const x = fixture(),
      policy = {
        ...defaultContextPolicy,
        highWaterTokens: 6000,
        lowWaterTokens: 3000,
      };
    let previous = x.view.record;
    for (const generation of [2, 3]) {
      previous.rotations = generation - 1;
      previous.lastRotation = {
        at: new Date().toISOString(),
        beforeTokens: 7000,
        checkpointSha256: "a".repeat(64),
        checkpointBytes: 100,
      };
      const fresh = runtimeContext(
        x.state,
        x.session,
        generation,
        policy,
        previous,
      );
      recordRuntimeDispatch(fresh.record, {
        historyLength: x.session.messages.length,
        promptBytes: 14000,
        visibleInputBytes: 0,
      });
      x.append(`a-${generation}`, "assistant", "Small observed answer");
      previous = runtimeContext(
        x.state,
        x.session,
        generation,
        policy,
        fresh.record,
      ).record;
    }
    const view = runtimeContext(x.state, x.session, 3, policy, previous);
    expect(view.record.estimatedIneffectiveRotations).toBe(2);
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ),
    ).toMatchObject({
      action: "hold_configuration",
      reason: "irreducible_context_overhead",
      estimated: true,
    });
    recordRuntimeUsage(view.record, {
      kind: "usage",
      id: "actual-small",
      at: Date.now() + 1,
      usedTokens: 1000,
      estimated: false,
      basis: "cli_usage",
    });
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ).action,
    ).toBe("continue");
  });

  it("does not trust prose, another assistant ID, or a ledger entry while an effect fence remains", () => {
    const x = fixture();
    recordRuntimeDispatch(x.view.record, {
      historyLength: 0,
      promptBytes: 0,
      visibleInputBytes: 0,
    });
    x.append("a", "assistant", "Human says verified");
    x.session.messages[0].tools = [
      { id: "tool", title: "Uncertain write", status: "in_progress" },
    ];
    const view = runtimeContext(
      x.state,
      x.session,
      1,
      defaultContextPolicy,
      x.view.record,
    );
    const ledger = {
      humanRequestId: "host-readback",
      epoch: 1,
      outcome: "not_applied" as const,
      evidenceRefs: ["host:verified-effect"],
      source: "human_host_ui" as const,
      at: Date.now(),
    };
    x.session.managed = {
      effectFence: false,
      reconciliations: [{ ...ledger, assistantMessageId: "wrong-a" }],
    } as Session["managed"];
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ).action,
    ).toBe("hold_unknown");
    x.session.managed!.reconciliations![0].assistantMessageId = "a";
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ).action,
    ).toBe("continue");
    x.session.managed!.effectFence = true;
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        view.record,
        view.envelope,
        true,
      ).action,
    ).toBe("hold_unknown");
  });

  it("re-evaluates overhead after manual fresh recovery even when its rotation count did not change", () => {
    for (const actual of [false, true]) {
      const x = fixture(),
        policy = {
          ...defaultContextPolicy,
          highWaterTokens: 6000,
          lowWaterTokens: 3000,
        };
      x.view.record.rotations = 2;
      x.view.record.ineffectiveRotations = actual ? 2 : 0;
      x.view.record.measuredRotation = 2;
      x.view.record.estimatedIneffectiveRotations = 2;
      x.view.record.estimatedRotation = 2;
      x.view.record.lastRotation = {
        at: new Date().toISOString(),
        beforeTokens: 7000,
        checkpointSha256: "a".repeat(64),
        checkpointBytes: 100,
      };
      let fresh = runtimeContext(x.state, x.session, 2, policy, x.view.record);
      expect(fresh.record.measuredRotation).toBeUndefined();
      expect(fresh.record.estimatedRotation).toBeUndefined();
      recordRuntimeDispatch(fresh.record, {
        historyLength: 0,
        promptBytes: 2000,
        visibleInputBytes: 0,
      });
      x.append("a", "assistant", "Small fresh baseline");
      fresh = runtimeContext(x.state, x.session, 2, policy, fresh.record);
      if (actual)
        recordRuntimeUsage(fresh.record, {
          kind: "usage",
          id: "fixed-native-base",
          at: Date.now() + 1,
          usedTokens: 1000,
          estimated: false,
          basis: "cli_usage",
        });
      x.append("b", "assistant", "x".repeat(20000));
      fresh = runtimeContext(x.state, x.session, 2, policy, fresh.record);
      expect(fresh.record.estimatedIneffectiveRotations).toBe(0);
      expect(fresh.record.ineffectiveRotations).toBe(0);
      expect(
        runtimeContextDecision(
          x.state,
          x.session,
          fresh.record,
          fresh.envelope,
          true,
        ).action,
      ).toBe("rotate_at_boundary");
    }
  });

  it("keeps legacy unresolved tools conservative but permits fresh diagnostics after an explicit generation boundary", () => {
    const x = fixture();
    x.append("old-a", "assistant", "Unknown old effects");
    x.session.messages[0].tools = [
      { id: "old-tool", title: "Write", status: "in_progress" },
    ];
    const legacy = runtimeContext(x.state, x.session, 1, defaultContextPolicy);
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        legacy.record,
        legacy.envelope,
        true,
      ).action,
    ).toBe("hold_unknown");
    const recovered = runtimeContext(
      x.state,
      x.session,
      2,
      defaultContextPolicy,
      legacy.record,
    );
    expect(
      runtimeContextDecision(
        x.state,
        x.session,
        recovered.record,
        recovered.envelope,
        true,
      ).action,
    ).toBe("continue");
    expect(x.session.messages[0].tools[0].status).toBe("in_progress");
  });
});
