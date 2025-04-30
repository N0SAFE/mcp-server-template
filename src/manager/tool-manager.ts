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
        if (this.toolsetConfig.mode === "readWrite") {
          this.enabledTools.add(name);
        }
        if (this.toolsetConfig.mode === "readOnly" && this.tools.get(name)?.definition.annotations?.readOnlyHint) {
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
          description:
            "Lists all available and currently enabled tools for this MCP server instance. " +
            "Use this tool to discover which tools you can enable or disable dynamically. " +
            "The response contains two arrays: 'available' (all tools you can enable/disable) and 'enabled' (tools currently enabled and callable). " +
            "You should always call this tool before attempting to enable or disable any tool, to ensure you have the latest list of tool names and their current state. " +
            "Note: The dynamic_tool_list and dynamic_tool_trigger tools are not included in the available/enabled lists.",
          inputSchema: z.object({}),
          annotations: {
            title: `Dynamic Tool Discovery`,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handler: () => {
          // Filter out the dynamic tools themselves from the lists
          const filterDynamic = (name: string) =>
            name !== dynamicToolListName && name !== dynamicToolTriggerName;
          // Helper to get tool info (name + description)
          const toolInfo = (name: string) => {
            const def = this.tools.get(name)?.definition;
            return {
              name: this.toExternalToolName(name),
              description: def ? this.toExternalToolDescription(def.description) : undefined,
            };
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    available: Array.from(this.tools.keys())
                      .filter(filterDynamic)
                      .map(toolInfo),
                    enabled: Array.from(this.enabledTools)
                      .filter(filterDynamic)
                      .map(toolInfo),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        },
      });
      this.enabledTools.add(dynamicToolListName);
      // Tool to enable/disable toolsets
      this.tools.set(dynamicToolTriggerName, {
        definition: {
          name: dynamicToolTriggerName,
          description:
            "Enables or disables one or more tools dynamically for this MCP server instance. " +
            "You must provide a list of toolsets, each with a 'name' (as returned by the dynamic_tool_list tool) and a 'trigger' (either 'enable' or 'disable'). " +
            "This tool should only be used after calling the dynamic_tool_list tool, to ensure you are using up-to-date tool names. " +
            "After enabling or disabling tools, the response will show the new state of available and enabled tools. " +
            "Note: The dynamic_tool_list and dynamic_tool_trigger tools cannot be enabled or disabled and are not accepted as valid tool names.",
          inputSchema: z.object({
            toolsets: z.array(
              z.object({
                name: z
                  .string()
                  .refine(
                    (name) => {
                      const internal = this.toInternalToolName(name);
                      return (
                        internal !== dynamicToolListName &&
                        internal !== dynamicToolTriggerName &&
                        this.tools.has(internal) &&
                        this.tools.get(internal)?.definition.name === internal
                      );
                    },
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
            const internal = this.toInternalToolName(name);
            if (internal === dynamicToolListName || internal === dynamicToolTriggerName) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Cannot enable/disable dynamic tools: ${name}`
              );
            }
            if (!this.tools.has(internal)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Unknown tool: ${name}`
              );
            }
            if (trigger === "enable") {
              this.enabledTools.add(internal);
            } else if (trigger === "disable") {
              this.enabledTools.delete(internal);
            }
          }
          await this.notifyEnabledToolsChanged();
          // Filter out the dynamic tools themselves from the lists
          const filterDynamic = (name: string) =>
            name !== dynamicToolListName && name !== dynamicToolTriggerName;
          const toolInfo = (name: string) => {
            const def = this.tools.get(name)?.definition;
            return {
              name: this.toExternalToolName(name),
              description: def ? this.toExternalToolDescription(def.description) : undefined,
            };
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    available: Array.from(this.tools.keys())
                      .filter(filterDynamic)
                      .map(toolInfo),
                    enabled: Array.from(this.enabledTools)
                      .filter(filterDynamic)
                      .map(toolInfo),
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
    return name.replace(`${this.mcpServerName}__`, "");
  }
  private toExternalToolName(name: string): string {
    return `${this.mcpServerName}__${name}`;
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
