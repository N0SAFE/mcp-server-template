import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CreateMessageRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type ToolMode = "readOnly" | "readWrite";

type ToolsetConfig = {
  mode: ToolMode;
};

interface DynamicToolDiscoveryOptions {
  enabled: boolean;
  availableToolsets: string[];
  defaultEnabledToolsets?: string[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations?: {
    // Optional hints about tool behavior
    title?: string; // Human-readable title for the tool
    readOnlyHint?: boolean; // If true, the tool does not modify its environment
    destructiveHint?: boolean; // If true, the tool may perform destructive updates
    idempotentHint?: boolean; // If true, repeated calls with same args have no additional effect
    openWorldHint?: boolean; // If true, tool interacts with external entities
  };
}

class McpServer {
  protected readonly _server: Server;
  private readonly toolsetConfig: ToolsetConfig;
  private resources?: {
    definitions: Record<string, any>;
    handlers: Record<string, (params: any) => Promise<any>>;
    onChange?: (resourceUri: string, resourceDefinition: any) => void;
  };
  private prompts?: {
    definitions: Record<string, any>;
    handlers: Record<string, (params: any) => Promise<any>>;
    onChange?: (promptName: string, promptDefinition: any) => void;
  };
  private readonly tools: Record<
    string,
    {
      definitions: ToolDefinition;
      handlers: (params: any) => Promise<any>;
    }
  > = {};
  private enabledTools: Set<string> = new Set();
  private enabledResources: Set<string> = new Set();
  private enabledPrompts: Set<string> = new Set();

  private toolCanBeEnabled(toolName: string, toolsetConfig: ToolsetConfig) {
    const tool = this.tools[toolName];
    if (toolsetConfig.mode === "readOnly") {
      return tool.definitions.annotations?.readOnlyHint === true;
    }
    return true;
  }

  initDynamicTooDiscovery(dynamicToolDiscovery: DynamicToolDiscoveryOptions) {
    if (dynamicToolDiscovery.enabled) {
      const toolsetListTool = {
        name: "dynamic_tool_list",
        description: "List, enable, or disable available tools dynamically.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
        annotations: {
          title: "Dynamic Tool Discovery",
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      };
      this.addTool(toolsetListTool, async (params: any) => {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  available: Object.keys(this.tools),
                  enabled: Array.from(this.enabledTools),
                },
                null,
                2
              ),
            },
          ],
        };
      });

      const toolsetTriggerTool = {
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
                  name: {
                    type: "string",
                    enum: dynamicToolDiscovery.availableToolsets,
                  },
                  trigger: {
                    type: "string",
                    enum: ["enable", "disable"],
                  },
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
      };

      this.addTool(toolsetTriggerTool, async (params: any) => {
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
              text: JSON.stringify(
                {
                  available: Object.keys(this.tools),
                  enabled: Array.from(this.enabledTools),
                },
                null,
                2
              ),
            },
          ],
        };
      });

      this.enableTool("dynamic_tool_list");
      this.enableTool("dynamic_tool_trigger");
    }
  }

  initTools(
    toolsCapabilities: Record<
      string,
      {
        definitions: Omit<ToolDefinition, "name">;
        handlers: (params: any) => Promise<any>;
        onChange?: (toolName: string, toolDefinition: ToolDefinition) => void;
      }
    >
  ) {
    Object.entries(toolsCapabilities).forEach(([name, tool]) => {
      this.addTool(
        {
          name,
          ...tool.definitions,
        },
        tool.handlers
      );
    });
  }

  constructor({
    name,
    version,
    capabilities,
    toolsetConfig,
    dynamicToolDiscovery,
  }: {
    name: string;
    version: string;
    capabilities?: {
      tools?: Record<
        string,
        {
          definitions: ToolDefinition;
          handlers: (params: any) => Promise<any>;
        }
      >;
      resources?: {
        definitions: Record<string, any>;
        handlers: Record<string, (params: any) => Promise<any>>;
        onChange?: (resourceUri: string, resourceDefinition: any) => void;
      };
      prompts?: {
        definitions: Record<string, any>;
        handlers: Record<string, (params: any) => Promise<any>>;
        onChange?: (promptName: string, promptDefinition: any) => void;
      };
    };
    onToolChange?: (toolName: string, toolDefinition: ToolDefinition) => void;
    toolsetConfig: ToolsetConfig;
    dynamicToolDiscovery?: DynamicToolDiscoveryOptions;
  }) {
    this.toolsetConfig = toolsetConfig;
    this.initTools(capabilities?.tools || {});
    this.resources = capabilities?.resources;
    this.prompts = capabilities?.prompts;
    this._server = new Server(
      {
        name,
        version,
      },
      {
        capabilities: {},
      }
    );

    // Only enable default tools at startup
    if (capabilities?.tools) {
      const defaultEnabled = dynamicToolDiscovery?.defaultEnabledToolsets || [];
      for (const toolName of defaultEnabled) {
        const toolset = capabilities.tools[toolName]?.definitions;
        if (toolset) {
          this.addTool(toolset, capabilities.tools[toolName].handlers);
        }
      }
    }
    if (this.resources) {
      for (const uri of Object.keys(this.resources.definitions)) {
        this.enableResource(uri);
      }
    }
    if (this.prompts) {
      for (const name of Object.keys(this.prompts.definitions)) {
        this.enablePrompt(name);
      }
    }

    // Only expose enabled tools
    if (capabilities?.tools) {
      const originalListToolsHandler = async () => {
        let tools = Object.entries(capabilities.tools!)
          .filter(([name]) => this.enabledTools.has(name) || name.startsWith("dynamic_tool_"))
          .map(([name, v]) => ({ ...v.definitions }));
        return { tools };
      };
      this._server.setRequestHandler(ListToolsRequestSchema, originalListToolsHandler);
      this._server.setRequestHandler(
        CallToolRequestSchema,
        async (request, _extra) => {
          const handler = capabilities.tools![request.params.name]?.handlers;
          if (!handler) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
          }
          if (!this.enabledTools.has(request.params.name) && !request.params.name.startsWith("dynamic_tool_")) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Tool not enabled: ${request.params.name}`
            );
          }
          return handler(request.params.arguments);
        }
      );
    }
    // Only expose enabled resources
    if (this.resources) {
      this._server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: this.resources && this.resources.definitions
          ? Object.entries(this.resources.definitions)
              .filter(([uri]) => this.enabledResources.has(uri) || uri === "dynamic_resource_list")
              .map(([uri, def]) => ({ uri, ...def }))
          : [],
      }));
      this._server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request, _extra) => {
          const handler = this.resources!.handlers[request.params.uri];
          if (!handler) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${request.params.uri}`
            );
          }
          if (!this.enabledResources.has(request.params.uri) && request.params.uri !== "dynamic_resource_list") {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Resource not enabled: ${request.params.uri}`
            );
          }
          return handler(request.params);
        }
      );
    }
    // Only expose enabled prompts
    if (this.prompts) {
      this._server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: this.prompts && this.prompts.definitions
          ? Object.entries(this.prompts.definitions)
              .filter(([name]) => this.enabledPrompts.has(name) || name === "dynamic_prompt_list")
              .map(([name, def]) => ({ name, ...def }))
          : [],
      }));
      this._server.setRequestHandler(
        GetPromptRequestSchema,
        async (request, _extra) => {
          const handler = this.prompts!.handlers[request.params.name];
          if (!handler) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${request.params.name}`
            );
          }
          if (!this.enabledPrompts.has(request.params.name) && request.params.name !== "dynamic_prompt_list") {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Prompt not enabled: ${request.params.name}`
            );
          }
          return handler(request.params);
        }
      );
    }

    // Notifications for list changes (stubs)
    // Example: this.server.notification({ method: "notifications/resources/list_changed" });
    // Example: this.server.notification({ method: "notifications/prompts/list_changed" });
    // Example: this.server.notification({ method: "notifications/tools/list_changed" });

    // Error handling
    this._server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this._server.close();
      process.exit(0);
    });
  }

  get server() {
    return this._server;
  }

  // --- Dynamic update methods ---
  protected addTool(
    definition: ToolDefinition,
    handler: (params: any) => Promise<any>
  ) {
    if (this.tools) {
      this.tools[definition.name].definitions = definition;
      this.tools[definition.name].handlers = handler;
      if (this.toolCanBeEnabled(definition.name, this.toolsetConfig)) {
        this.enableTool(definition.name);
      }
    }
  }

  protected removeTool(name: string) {
    if (this.tools && this.tools[name].definitions) {
      this.disableTool(name);
      delete this.tools[name];
    }
  }

  protected addResource(
    uri: string,
    definition?: any,
    handler?: (params: any) => Promise<any>
  ) {
    if (definition && handler && this.resources) {
      this.resources.definitions[uri] = definition;
      this.resources.handlers[uri] = handler;
      this.enableResource(uri);
    }
  }

  protected removeResource(uri: string) {
    if (this.resources && this.resources.definitions[uri]) {
      this.disableResource(uri);
      delete this.resources.definitions[uri];
      delete this.resources.handlers[uri];
    }
  }

  protected addPrompt(
    name: string,
    definition?: any,
    handler?: (params: any) => Promise<any>
  ) {
    if (definition && handler && this.prompts) {
      this.prompts.definitions[name] = definition;
      this.prompts.handlers[name] = handler;
      this.enablePrompt(name);
    }
  }

  protected removePrompt(name: string) {
    if (this.prompts && this.prompts.definitions[name]) {
      this.disablePrompt(name);
      delete this.prompts.definitions[name];
      delete this.prompts.handlers[name];
    }
  }

  protected enableTool(name: string) {
    if (this.tools && this.tools[name]) {
      this.enabledTools.add(name);
      this._server.notification({ method: "notifications/tools/list_changed" });
    }
  }
  protected disableTool(name: string) {
    if (this.tools && this.tools[name]) {
      this.enabledTools.delete(name);
      this._server.notification({ method: "notifications/tools/list_changed" });
    }
  }
  protected enableResource(uri: string) {
    if (this.resources && this.resources.definitions[uri]) {
      this.enabledResources.add(uri);
      this._server.notification({
        method: "notifications/resources/list_changed",
      });
      this.resources.onChange?.(uri, this.resources.definitions[uri]);
    }
  }
  protected disableResource(uri: string) {
    if (this.resources && this.resources.definitions[uri]) {
      this.enabledResources.delete(uri);
      this._server.notification({
        method: "notifications/resources/list_changed",
      });
      this.resources.onChange?.(uri, {} as any);
    }
  }
  protected enablePrompt(name: string) {
    if (this.prompts && this.prompts.definitions[name]) {
      this.enabledPrompts.add(name);
      this._server.notification({
        method: "notifications/prompts/list_changed",
      });
      this.prompts.onChange?.(name, this.prompts.definitions[name]);
    }
  }
  protected disablePrompt(name: string) {
    if (this.prompts && this.prompts.definitions[name]) {
      this.enabledPrompts.delete(name);
      this._server.notification({
        method: "notifications/prompts/list_changed",
      });
      this.prompts.onChange?.(name, {} as any);
    }
  }
}

const helloWorldTool: ToolDefinition = {
  name: "helloWorld",
  description: "Returns a Hello World greeting.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  annotations: {
    title: "Hello World Tool",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const toolHandlers = async () => ({
  content: [
    {
      type: "text",
      text: "Hello, World!",
    },
  ],
});

async function main() {
  const mcpServer = new McpServer({
    toolsetConfig: {
      mode: "readOnly",
    },
    name: "hello-world-server",
    version: "1.0.0",
    capabilities: {
      tools: {
        helloWorldTool: {
          definitions: helloWorldTool,
          handlers: toolHandlers,
        },
      },
    },
  });

  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);
  console.error("Hello World MCP server running on stdio");
}

main().catch((error) => console.error(error));
