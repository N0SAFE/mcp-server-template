// ToolManager handles tool logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ToolDefinition, ToolMode, ToolsetConfig, DynamicToolDiscoveryOptions } from "../types";

export class ToolManager {
  private readonly tools: Record<string, { definitions: ToolDefinition; handlers: (params: any) => Promise<any>; }> = {};
  private enabledTools: Set<string> = new Set();
  private toolsetConfig: ToolsetConfig;
  constructor(
    toolsCapabilities: Record<string, { definitions: ToolDefinition; handlers: (params: any) => Promise<any>; }>,
    toolsetConfig: ToolsetConfig,
    dynamicToolDiscovery?: DynamicToolDiscoveryOptions
  ) {
    this.toolsetConfig = toolsetConfig;
    Object.entries(toolsCapabilities).forEach(([name, tool]) => {
      this.tools[name] = tool;
      this.enabledTools.add(name);
    });
    // Dynamic tool discovery logic
    if (dynamicToolDiscovery?.enabled) {
      // Tool to list available/enabled tools
      this.tools["dynamic_tool_list"] = {
        definitions: {
          name: "dynamic_tool_list",
          description: "List, enable, or disable available tools dynamically.",
          inputSchema: { type: "object", properties: {}, required: [] },
          annotations: {
            title: "Dynamic Tool Discovery",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handlers: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                available: Object.keys(this.tools),
                enabled: Array.from(this.enabledTools),
              }, null, 2),
            },
          ],
        }),
      };
      this.enabledTools.add("dynamic_tool_list");
      // Tool to enable/disable toolsets
      this.tools["dynamic_tool_trigger"] = {
        definitions: {
          name: "dynamic_tool_trigger",
          description: "Enable or disable multiple toolsets.",
          inputSchema: {
            type: "object",
            properties: {
              toolsets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", enum: dynamicToolDiscovery.availableToolsets },
                    trigger: { type: "string", enum: ["enable", "disable"] },
                  },
                  required: ["name", "trigger"],
                },
              },
            },
            required: ["toolsets"],
          },
          annotations: {
            title: "Dynamic Tool Trigger",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handlers: async (params: any) => {
          const { toolsets } = params;
          for (const { name, trigger } of toolsets) {
            if (trigger === "enable") {
              this.enabledTools.add(name);
            } else if (trigger === "disable") {
              this.enabledTools.delete(name);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  available: Object.keys(this.tools),
                  enabled: Array.from(this.enabledTools),
                }, null, 2),
              },
            ],
          };
        },
      };
      this.enabledTools.add("dynamic_tool_trigger");
      // Optionally enable default toolsets
      if (dynamicToolDiscovery.defaultEnabledToolsets) {
        for (const toolName of dynamicToolDiscovery.defaultEnabledToolsets) {
          if (this.tools[toolName]) {
            this.enabledTools.add(toolName);
          }
        }
      }
    }
  }
  async listTools() {
    return {
      tools: Object.entries(this.tools)
        .filter(([name]) => this.enabledTools.has(name))
        .map(([_, v]) => v.definitions),
    };
  }
  async callTool(request: any) {
    const handler = this.tools[request.params.name]?.handlers;
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
    if (!this.enabledTools.has(request.params.name)) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not enabled: ${request.params.name}`);
    }
    return handler(request.params.arguments);
  }
}
