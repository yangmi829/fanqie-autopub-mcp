#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./core/logger.js";
import { ensureDirs } from "./core/paths.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerNovelTools } from "./tools/novel.js";
import { registerChapterTools } from "./tools/chapter.js";
import { registerShortStoryTools } from "./tools/shortStory.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerResources } from "./resources/index.js";
const SERVER_NAME = "fanqie-autopub-mcp";
const SERVER_VERSION = "1.0.0";
export function buildServer() {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerAuthTools(server);
    registerNovelTools(server);
    registerChapterTools(server);
    registerShortStoryTools(server);
    registerLibraryTools(server);
    registerKnowledgeTools(server);
    registerStatsTools(server);
    registerResources(server);
    return server;
}
async function main() {
    ensureDirs();
    // 便于排障：--selfcheck 只打印环境信息后退出，不启动 stdio 传输
    if (process.argv.includes("--selfcheck")) {
        const { automationReadiness } = await import("./services/auth.js");
        process.stderr.write(JSON.stringify(automationReadiness(), null, 2) + "\n");
        return;
    }
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} 已就绪（stdio），共注册 25 个工具、8 个只读资源。`);
}
main().catch((e) => {
    logger.error(`启动失败: ${e.stack ?? e.message}`);
    process.exit(1);
});
