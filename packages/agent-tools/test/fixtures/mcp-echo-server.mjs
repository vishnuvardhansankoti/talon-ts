#!/usr/bin/env node
// Minimal MCP stdio server fixture for test/config/mcp-client.test.ts — exposes
// one trivial "echo" tool so connectMcpEntry's discovery/call/close path can
// be exercised against a real stdio child process, not a mock.
import process from "node:process";
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
    {
      // Exercises McpToolEntry.env (stdio) — reports back whatever this
      // process actually received in its own environment, so a test can
      // confirm a value set via connectMcpEntry's `env` resolution really
      // reached the spawned child, not just that no error was thrown.
      name: "env_echo",
      description: "Echoes the named environment variable back.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo") {
    return { content: [{ type: "text", text: String(request.params.arguments?.value ?? "") }] };
  }
  if (request.params.name === "env_echo") {
    const name = String(request.params.arguments?.name ?? "");
    return { content: [{ type: "text", text: process.env[name] ?? "" }] };
  }
  throw new Error(`unknown tool "${request.params.name}"`);
});

await server.connect(new StdioServerTransport());
