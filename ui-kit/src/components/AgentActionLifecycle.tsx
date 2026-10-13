import type { ReactNode } from "react";

export type AgentActionStage = "proposal" | "preview" | "execute" | "result" | "verify" | "evidence";
export type AgentActionStepState = "pending" | "current" | "complete" | "failed";

export interface AgentActionStep {
  stage: AgentActionStage;
  label: string;
  state: AgentActionStepState;
  detail?: ReactNode;
}

export interface AgentActionLifecycleProps {
  title: string;
  target: string;
  steps: AgentActionStep[];
}

export function AgentActionLifecycle({ title, target, steps }: AgentActionLifecycleProps) {
  return (
    <section className="gc-card" aria-label={title}>
      <header className="gc-card__header">
        <strong>{title}</strong>
        <span style={{ marginInlineStart: "auto", color: "var(--ui-text-secondary)", fontSize: 11 }}>{target}</span>
      </header>
      <ol className="gc-lifecycle">
        {steps.map((step) => (
          <li
            className="gc-lifecycle__step"
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            key={step.stage}
          >
            <span className="gc-lifecycle__mark" aria-hidden="true">{step.state === "complete" ? "✓" : ""}</span>
            <span className="gc-lifecycle__label">{step.label}</span>
            {step.detail ? <small>{step.detail}</small> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
