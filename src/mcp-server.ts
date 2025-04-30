// McpServer main class split from index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ToolsetConfig,
  DynamicToolDiscoveryOptions,
  ToolCapability,
} from "./types";
import { ToolManager } from "./manager/tool-manager";
import { ResourceManager } from "./manager/resource-manager";
import { PromptManager } from "./manager/prompt-manager";

export class McpServer {
  protected readonly _server: Server;
  protected readonly toolsetConfig: ToolsetConfig;
  private readonly toolManager: ToolManager;
  private readonly resourceManager: ResourceManager;
  private readonly promptManager: PromptManager;

  constructor({
    name,
    version,
    capabilities,
    toolsetConfig,
    dynamicToolDiscovery,
    instructions,
  }: {
    name: string;
    version: string;
    capabilities?: { tools?: ToolCapability[]; resources?: any; prompts?: any };
    toolsetConfig: ToolsetConfig;
    dynamicToolDiscovery?: DynamicToolDiscoveryOptions;
    instructions?: string;
  }) {
    this.toolsetConfig = toolsetConfig;
    this.toolManager = new ToolManager(
      name,
      capabilities?.tools || [],
      toolsetConfig,
      dynamicToolDiscovery
    );
    // Ensure resources and prompts are always valid objects
    const resources = capabilities?.resources ?? {
      definitions: {},
      handlers: {},
    };
    const prompts = capabilities?.prompts ?? { definitions: {}, handlers: {} };
    this.resourceManager = new ResourceManager(resources);
    this.promptManager = new PromptManager(prompts);
    // Determine capabilities for the MCP server
    const hasTools = this.toolManager.hasTools();
    const hasResources = this.resourceManager.hasResources();
    const hasPrompts = this.promptManager.hasPrompts();
    this._server = new Server(
      {
        name,
        version,
      },
      {
        capabilities: {
          ...(hasTools ? { tools: {} } : {}),
          ...(hasResources ? { resources: {} } : {}),
          ...(hasPrompts ? { prompts: {} } : {}),
          logging: {}
        },
        instructions,
      }
    );
    // Register handlers
    if (hasTools) {
      this._server.setRequestHandler(
        ListToolsRequestSchema,
        this.toolManager.listTools.bind(this.toolManager)
      );
      this._server.setRequestHandler(
        CallToolRequestSchema,
        this.toolManager.callTool.bind(this.toolManager)
      );
      this.toolManager.onEnabledToolsChanged(
        this._server.sendToolListChanged.bind(this._server)
      );
    }

    if (hasResources) {
      this._server.setRequestHandler(
        ListResourcesRequestSchema,
        this.resourceManager.listResources.bind(this.resourceManager)
      );
      this._server.setRequestHandler(
        ReadResourceRequestSchema,
        this.resourceManager.readResource.bind(this.resourceManager)
      );
    }
    if (hasPrompts) {
      this._server.setRequestHandler(
        ListPromptsRequestSchema,
        this.promptManager.listPrompts.bind(this.promptManager)
      );
      this._server.setRequestHandler(
        GetPromptRequestSchema,
        this.promptManager.getPrompt.bind(this.promptManager)
      );
    }
    // Error handling
    this._server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      this.toolManager.offEnabledToolsChanged(
        this._server.sendToolListChanged.bind(this._server)
      );
      await this._server.close();
      process.exit(0);
    });
  }
  get server() {
    return this._server;
  }
}
