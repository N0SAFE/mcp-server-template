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
  params: z.infer<T["inputSchema"]>
) => Promisable<{
  content: {
    type: string;
    text: string;
  }[];
}>;

export type ToolCapability<T extends ToolDefinition = ToolDefinition> = {
    definition: T;
    handler: ToolHandler<T>;
};

export type Promisable<T> = T | Promise<T>;