import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '../mcp-server.js';
import { ToolDefinition } from '../types.js';

const helloWorldTool: ToolDefinition = {
  name: 'helloWorld',
  description: 'Returns a Hello World greeting.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: {
    title: 'Hello World Tool',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

describe('McpServer', () => {
  let mcpServer: McpServer;
  beforeEach(() => {
    mcpServer = new McpServer({
      name: 'test-server',
      version: '1.0.0',
      toolsetConfig: { mode: 'readOnly' },
      capabilities: {
        tools: {
          helloWorld: {
            definitions: helloWorldTool,
            handlers: async () => ({
              content: [
                { type: 'text', text: 'Hello, World!' },
              ],
            }),
          },
        },
      },
    });
  });

  it('should list enabled tools', async () => {
    const result = await mcpServer['toolManager'].listTools();
    expect(result.tools.length).toBe(1);
    expect(result.tools[0].name).toBe('helloWorld');
  });

  it('should call enabled tool', async () => {
    const result = await mcpServer['toolManager'].callTool({ params: { name: 'helloWorld', arguments: {} } });
    expect(result.content[0].text).toBe('Hello, World!');
  });

  it('should throw for disabled tool', async () => {
    mcpServer['toolManager']['enabledTools'].delete('helloWorld');
    await expect(mcpServer['toolManager'].callTool({ params: { name: 'helloWorld', arguments: {} } })).rejects.toThrow();
  });
});
