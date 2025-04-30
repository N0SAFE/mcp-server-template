// ToolManager handles tool logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ToolDefinition,
  ToolsetConfig,
  DynamicToolDiscoveryOptions,
  ToolCapability,
} from "../types";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type ToolListResponse = {
  tools: (Omit<ToolDefinition, "inputSchema"> & {
    inputSchema: any;
  })[];
};

export class ToolManager {
  private readonly tools: Map<string, ToolCapability> = new Map();
  private enabledTools: Set<string> = new Set();
  private enabledToolSubscriptions: Set<(tools: ToolListResponse) => void> =
    new Set();
  private mcpServerName: string;
  constructor(
    mcpServerName: string,
    private toolsCapabilities: ToolCapability[],
    private toolsetConfig: ToolsetConfig,
    private dynamicToolDiscovery?: DynamicToolDiscoveryOptions
  ) {
    // replace -, sentence case and space with _ in mcpServerName
    this.mcpServerName = mcpServerName;

    this.toolsCapabilities.forEach((capability) => {
      this.tools.set(capability.definition.name, capability);
    });
    if (this.dynamicToolDiscovery?.enabled) {
      this.dynamicToolDiscovery.defaultEnabledToolsets?.forEach((toolName) => {
        if (this.tools.get(toolName)) {
          this.enabledTools.add(toolName);
        }
      });
    } else {
      this.tools.forEach((_, name) => {
        if (this.toolsetConfig.mode === "readOnly") {
          this.enabledTools.add(name);
        }
      });
    }
    // Dynamic tool discovery logic
    if (this.dynamicToolDiscovery?.enabled) {
      const dynamicToolListName = `dynamic_tool_list`;
      const dynamicToolTriggerName = `dynamic_tool_trigger`;
      // Tool to list available/enabled tools
      this.tools.set(dynamicToolListName, {
        definition: {
          name: dynamicToolListName,
          description: "List, enable, or disable available tools dynamically.",
          inputSchema: z.object({}),
          annotations: {
            title: `Dynamic Tool Discovery`,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handler: () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  available: Array.from(this.tools.keys()).map(tool => this.toExternalToolName(tool)),
                  enabled: Array.from(this.enabledTools).map(tool => this.toExternalToolName(tool)),
                },
                null,
                2
              ),
            },
          ],
        }),
      });
      this.enabledTools.add(dynamicToolListName);
      // Tool to enable/disable toolsets
      this.tools.set(dynamicToolTriggerName, {
        definition: {
          name: dynamicToolTriggerName,
          description: "Enable or disable multiple toolsets.",
          inputSchema: z.object({
            toolsets: z.array(
              z.object({
                name: z
                  .string()
                  .refine(
                    (name) =>
                      this.tools.has(this.toInternalToolName(name)) &&
                      this.tools.get(this.toInternalToolName(name))?.definition.name === this.toInternalToolName(name),
                    {
                      message: "Invalid toolset name",
                    }
                  ),
                trigger: z.enum(["enable", "disable"]),
              })
            ),
          }),
          annotations: {
            title: `Dynamic Tool Trigger`,
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handler: async (params: any) => {
          const { toolsets } = params;
          for (const { name, trigger } of toolsets) {
            if (trigger === "enable") {
              this.enabledTools.add(this.toInternalToolName(name));
            } else if (trigger === "disable") {
              this.enabledTools.delete(this.toInternalToolName(name));
            }
          }
          await this.notifyEnabledToolsChanged();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    available: Array.from(this.tools.keys()).map(tool => this.toExternalToolName(tool)),
                    enabled: Array.from(this.enabledTools).map(tool => this.toExternalToolName(tool)),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        },
      });
      this.enabledTools.add(dynamicToolTriggerName);
    }
  }
  listTools(): ToolListResponse {
    return {
      tools: Array.from(this.tools)
        .filter(([name]) => this.enabledTools.has(name))
        .map(([_, v]) =>
          v.definition.inputSchema
            ? {
                ...(v.definition.annotations
                  ? {
                      ...v.definition,
                      annotations: {
                        ...v.definition.annotations,
                        title: this.toExternalToolDescription(
                          v.definition.description
                        ),
                      },
                    }
                  : v.definition),
                inputSchema: zodToJsonSchema(v.definition.inputSchema, {
                  $refStrategy: "none",
                }),
              }
            : {
                ...(v.definition.annotations
                  ? {
                      ...v.definition,
                      annotations: {
                        ...v.definition.annotations,
                        title: this.toExternalToolDescription(
                          v.definition.description
                        ),
                      },
                    }
                  : v.definition),
                inputSchema: zodToJsonSchema(z.object({})),
              }
        )
        .map((tool) => {
          return {
            ...tool,
            name: this.toExternalToolName(tool.name),
            description: this.toExternalToolDescription(tool.description),
          };
        }),
    };
  }
  async callTool(request: any) {
    const toolName = this.toInternalToolName(request.params.name);
    const toolCapability = this.tools.get(toolName);
    if (!toolCapability) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }
    if (!this.enabledTools.has(toolName)) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Tool not enabled: ${request.params.name}`
      );
    }
    if (!request.params.arguments) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${request.params.arguments}`
      );
    }
    const toolDefinition = toolCapability.definition;
    const inputSchema = toolDefinition.inputSchema;
    const validationResult = inputSchema.safeParse(request.params.arguments);
    if (!validationResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${validationResult.error}`
      );
    }
    return toolCapability.handler(request.params.arguments);
  }

  private notifyEnabledToolsChanged() {
    const tools = this.listTools();
    for (const callback of this.enabledToolSubscriptions) {
      callback(tools);
    }
  }

  private toInternalToolName(name: string): string {
    return name.replace(`${this.mcpServerName}::`, "");
  }
  private toExternalToolName(name: string): string {
    return `${this.mcpServerName}::${name}`;
  }
  private toExternalToolDescription(description: string): string {
    return `[${this.mcpServerName}] ${description}`;
  }

  onEnabledToolsChanged(callback: (tools: ToolListResponse) => void): void {
    this.enabledToolSubscriptions.add(callback);
  }
  offEnabledToolsChanged(callback: (tools: ToolListResponse) => void): void {
    this.enabledToolSubscriptions.delete(callback);
  }

  setMcpServerName(name: string) {
    this.mcpServerName = name;
    if (this.dynamicToolDiscovery?.enabled) {
      this.notifyEnabledToolsChanged();
    }
  }

  dynamicToolDiscoveryEnabled(): boolean {
    return this.dynamicToolDiscovery?.enabled ?? false;
  }

  hasTools() {
    return this.tools.size > 0;
  }
}
