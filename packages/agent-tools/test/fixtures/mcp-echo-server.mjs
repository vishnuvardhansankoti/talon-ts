#!/usr/bin/env node
// Minimal MCP stdio server fixture for test/config/mcp-client.test.ts — exposes
// one trivial "echo" tool so connectMcpEntry's discovery/call/close path can
// be exercised against a real stdio child process, not a mock.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "echo-fixture", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echoes its input back.",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "echo") {
    throw new Error(`unknown tool "${request.params.name}"`);
  }
  return { content: [{ type: "text", text: String(request.params.arguments?.value ?? "") }] };
});

await server.connect(new StdioServerTransport());
