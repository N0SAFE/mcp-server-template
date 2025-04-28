// Shared types for McpServer and managers
export type ToolMode = "readOnly" | "readWrite";
export type ToolsetConfig = {
  mode: ToolMode;
};
export interface DynamicToolDiscoveryOptions {
  enabled: boolean;
  availableToolsets: string[];
  defaultEnabledToolsets?: string[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
