import type { HTMLAttributes, ReactNode } from "react";

export type StatusTone = "neutral" | "success" | "info" | "warning" | "danger";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  children: ReactNode;
}

export function StatusBadge({ tone = "neutral", className = "", children, ...props }: StatusBadgeProps) {
  return (
    <span {...props} className={`gc-status gc-status--${tone} ${className}`.trim()}>
      {children}
    </span>
  );
}
