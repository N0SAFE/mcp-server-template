// ResourceManager handles resource logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class ResourceManager {
  private readonly resources: { definitions: Record<string, any>; handlers: Record<string, (params: any) => Promise<any>>; };
  private enabledResources: Set<string> = new Set();
  constructor(resources: { definitions: Record<string, any>; handlers: Record<string, (params: any) => Promise<any>>; }) {
    this.resources = resources;
    Object.keys(resources.definitions).forEach((uri) => this.enabledResources.add(uri));
  }
  async listResources() {
    return {
      resources: Object.entries(this.resources.definitions)
        .filter(([uri]) => this.enabledResources.has(uri))
        .map(([uri, def]) => ({ uri, ...def })),
    };
  }
  async readResource(request: any) {
    const handler = this.resources.handlers[request.params.uri];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown resource: ${request.params.uri}`);
    }
    if (!this.enabledResources.has(request.params.uri)) {
      throw new McpError(ErrorCode.MethodNotFound, `Resource not enabled: ${request.params.uri}`);
    }
    return handler(request.params);
  }

  hasResources() {
    return Object.keys(this.resources.definitions).length > 0;
  }
}
