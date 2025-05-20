import * as z from "zod";
import { ZodRawShape } from "zod";

// Shared types for McpServer and managers
export type ToolMode = "readOnly" | "readWrite";
export type ToolsetConfig = {
  mode: ToolMode;
};
export interface DynamicToolDiscoveryOptions {
  enabled: boolean;
  defaultEnabledToolsets?: string[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<ZodRawShape>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export type ToolHandler<T extends ToolDefinition> = (
  params: z.infer<T["inputSchema"]>,
  ...[req, opts]: [
    {
      method: "tools/call";
      params: {
        _meta: Record<string, unknown>;
        name: string;
        arguments: Record<string, unknown>;
      };
    },
    {
      signal: AbortSignal;
      sessionId: string;
      _meta: unknown;
      sendNotification: (type: string, payload: unknown) => void;
      sendRequest: () => Promise<unknown>;
      authInfo: AuthInfo;
      requestId: string;
    },
  ]
) => Promisable<{
  content: {
    type: string;
    text: string;
  }[];
}>;

export type ToolCapability<T extends ToolDefinition = ToolDefinition> = {
  definition: T;
  handler: ToolHandler<T>;
  meta?: {
    canBeEnabled?: (authInfo: AuthInfo) => Promisable<boolean>;
  };
};

export type Promisable<T> = T | Promise<T>;

export type McpConfig = {
  toolsetConfig: any;
  availableTools: string[];
  dynamicToolDiscovery:
    | {
        enabled: true;
        defaultEnabledToolsets: string[];
      }
    | {
        enabled: false;
      };
};

export type AuthInfo = {
  token: string;
  clientId: string;
  scopes: Array<unknown>;
  extra: Record<string, unknown>;
};