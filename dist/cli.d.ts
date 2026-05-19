#!/usr/bin/env node
/**
 * przm Memory CLI router.
 *
 * Usage:
 *   przm-memory-mcp                                                 → run MCP stdio server (back-compat)
 *   przm-memory-mcp search --query <q> [--project <p>] [--limit N]
 *                     [--min-relevance F] [--format json|text]
 *   przm-memory-mcp query  [--project <p>] [--tier <t>]
 *                     [--min-importance F] [--limit N] [--format json|text]
 *   przm-memory-mcp help
 *
 * The CLI is additive — it wraps the same search/storage primitives the
 * MCP server uses so hook scripts can pull memories without speaking
 * stdio JSON-RPC.
 */
export {};
