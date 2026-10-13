import type { ReactNode, SVGAttributes } from "react";

export type IconName =
  | "add"
  | "agent"
  | "branch"
  | "browser"
  | "check"
  | "chevron-down"
  | "close"
  | "component"
  | "data"
  | "error"
  | "information"
  | "publish"
  | "repository"
  | "search"
  | "settings"
  | "template"
  | "tokens"
  | "warning";

const paths: Record<IconName, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  agent: <><rect x="5" y="7" width="14" height="12" rx="3" /><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" /></>,
  branch: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="8" r="2" /><circle cx="7" cy="19" r="2" /><path d="M7 7v10M9 9c5 0 4-1 6-1" /></>,
  browser: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18M6 6h.01M9 6h.01" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  component: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><path d="M13 16.5h7M16.5 13v7" /></>,
  data: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  information: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  publish: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M5 13v6h14v-6" /></>,
  repository: <><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" /><path d="M5 16h14M9 8h6M9 11h4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19 15 2 1-2 3-2-1a8 8 0 0 1-3 2v2h-4v-2a8 8 0 0 1-3-2l-2 1-2-3 2-1a8 8 0 0 1 0-3l-2-1 2-3 2 1a8 8 0 0 1 3-2V5h4v2a8 8 0 0 1 3 2l2-1 2 3-2 1a8 8 0 0 1 0 3Z" /></>,
  template: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  tokens: <><circle cx="8" cy="8" r="4" /><circle cx="16" cy="8" r="4" /><circle cx="12" cy="16" r="4" /></>,
  warning: <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
};

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "children"> {
  name: IconName;
  /** Accessible icons need a short title; decorative icons omit it. */
  title?: string;
}

export function Icon({ name, title, className = "", ...props }: IconProps) {
  return (
    <svg
      {...props}
      className={`gc-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}
