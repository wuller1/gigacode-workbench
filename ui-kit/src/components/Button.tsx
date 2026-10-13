import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon.js";
import type { IconName } from "./Icon.js";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon, loading = false, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`gc-button gc-button--${variant} ${className}`.trim()}
    >
      {loading ? <span className="gc-button__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: IconName;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, className = "", ...props },
  ref,
) {
  return (
    <Button {...props} ref={ref} icon={icon} className={`gc-icon-button ${className}`.trim()}>
      <span className="gc-visually-hidden">{label}</span>
    </Button>
  );
});
