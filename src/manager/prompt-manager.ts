// PromptManager handles prompt logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export class PromptManager {
  private readonly prompts: { definitions: Record<string, any>; handlers: Record<string, (params: any) => Promise<any>>; };
  private enabledPrompts: Set<string> = new Set();
  constructor(prompts: { definitions: Record<string, any>; handlers: Record<string, (params: any) => Promise<any>>; }) {
    this.prompts = prompts;
    Object.keys(prompts.definitions).forEach((name) => this.enabledPrompts.add(name));
  }
  async listPrompts() {
    return {
      prompts: Object.entries(this.prompts.definitions)
        .filter(([name]) => this.enabledPrompts.has(name))
        .map(([name, def]) => ({ name, ...def })),
    };
  }
  async getPrompt(request: any) {
    const handler = this.prompts.handlers[request.params.name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${request.params.name}`);
    }
    if (!this.enabledPrompts.has(request.params.name)) {
      throw new McpError(ErrorCode.MethodNotFound, `Prompt not enabled: ${request.params.name}`);
    }
    return handler(request.params);
  }

  hasPrompts() {
    return Object.keys(this.prompts.definitions).length > 0;
  }
}
