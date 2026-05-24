#!/usr/bin/env node
/*
 * mcp-xray-pilot — MCP server for xray-core configuration.
 *
 * Exposes 5 tools (xray_list_topics, xray_fetch_topic, xray_search,
 * xray_validate_config, xray_lint) and one resource (xray://docs/index)
 * for clients that prefer resources over tools.
 *
 * Transport: stdio. Wire it into Claude Code, Cursor, Cline, etc. via:
 *   `npx -y mcp-xray-pilot`  or  `node dist/index.js`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_SCHEMAS } from "./tools.js";
import { dispatch } from "./handlers.js";
import { loadIndex } from "./state.js";

const server = new Server(
  { name: "mcp-xray-pilot", version: "0.15.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_SCHEMAS as unknown as never,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  return (await dispatch(name, args)) as never;
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const idx = await loadIndex();
  return {
    resources: [
      {
        uri: "xray://docs/index",
        name: "xray docs index",
        description: `Index of ${idx.length} cached xray-core documentation pages.`,
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri !== "xray://docs/index") {
    throw new Error(`Unknown resource: ${req.params.uri}`);
  }
  const idx = await loadIndex();
  return {
    contents: [
      {
        uri: req.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(idx, null, 2),
      },
    ],
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  /* Server is running; stdio is now owned by the MCP transport.
   * Do NOT log to stdout — that would corrupt JSON-RPC framing.
   * Stderr is fine if you ever need diagnostics. */
}

main().catch((e) => {
  process.stderr.write(`[mcp-xray-pilot] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
