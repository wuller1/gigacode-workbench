import type { ReactNode, SVGAttributes } from "react";

export type IconName =
  | "copy"
  | "format"
  | "more"
  | "edit"
  | "send-now"
  | "send"
  | "attach"
  | "stop"
  | "chevron-left"
  | "chevron-right"
  | "folder"
  | "file"
  | "terminal"
  | "filter"
  | "download"
  | "refresh"
  | "split"
  | "plan"
  | "pointer"
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
  copy: <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 8V3H3v13h5" /></>,
  format: <><path d="m7 7-4 5 4 5M17 7l4 5-4 5M14 5l-4 14" /></>,
  "more": <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  "edit": <><path d="m5 15-1 5 5-1L20 8l-4-4L5 15Z" /><path d="m13 7 4 4" /></>,
  "send-now": <><path d="m9 5 8 7-8 7V5Z" /><path d="M4 5v14M20 5v14" /></>,
  "send": <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
  "attach": <path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9" />,
  "stop": <rect x="6" y="6" width="12" height="12" rx="1" />,
  "chevron-left": <path d="m14 6-6 6 6 6" />,
  "chevron-right": <path d="m10 6 6 6-6 6" />,
  "folder": <path d="M3 7V5h7l2 3h9v12H3V7Z" />,
  "file": <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>,
  "terminal": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m6 9 4 3-4 3M13 16h5" /></>,
  "filter": <><path d="M4 6h16M7 12h10M10 18h4" /></>,
  "download": <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
  "refresh": <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>,
  "split": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  "plan": <><path d="m4 7 2 2 3-4M12 7h8M4 14h5M12 14h8M4 20h5M12 20h8" /></>,
  "pointer": <path d="m5 3 13 10-6 1-3 6L5 3Z" />,

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
