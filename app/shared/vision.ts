export interface VisionBridgeConfig {
  mode: "text_bridge" | "disabled";
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string[];
  ca: string;
  toolName: string;
  /** Actual discovered tool schema controls this object; exact placeholders only. */
  argumentsTemplate: Record<string, unknown>;
  modelLabel: string;
  secretName: string;
  secretPrefix: string;
}
export interface VisionBridgeObservation {
  mode: "text_bridge";
  imageSha256: string;
  bridgeLabel: string;
  toolName: string;
  schemaSha256: string;
  description: string;
  capturedAt: string;
  cached: boolean;
  trust: string;
}
