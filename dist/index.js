#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./core/logger.js";
import { ensureDirs, DATA_DIR, DATA_DIR_SOURCE, PACKAGE_VERSION } from "./core/paths.js";
import { describeRemote, remoteRequested } from "./core/remote.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerNovelTools } from "./tools/novel.js";
import { registerChapterTools } from "./tools/chapter.js";
import { registerShortStoryTools } from "./tools/shortStory.js";
import { registerMicroHeadlineTools } from "./tools/microHeadline.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerStatsTools } from "./tools/stats.js";
import { registerResources } from "./resources/index.js";
const SERVER_NAME = "fanqie-autopub-mcp";
/** 单一真源＝package.json（见 core/paths.ts 的 PACKAGE_VERSION），不要在这里写死版本号 */
const SERVER_VERSION = PACKAGE_VERSION;
/**
 * MCP 握手时返回给客户端的跨工具使用约定。
 * 只写「所有工具都适用」的元规则；单工具细节留在 tools/* 的描述里，避免两处漂移。
 */
const INSTRUCTIONS = [
    "番茄小说（fanqienovel.com）作者后台自动发布服务。只操作番茄，不要与本机七猫（qimao）服务的工具混用。",
    "1) 写操作默认 confirm=false：只做预览（填表或读现状 + 截图），不提交。预览后把待提交内容 / 截图 / 返回的 content 交给用户确认；用户同意后再用同样的参数加 confirm=true 重调。涉及自动保存的编辑器在预览时不会填入正文。",
    "2) 内容声明（是否使用AI）默认取肯定项；只有用户明确要求「本人原创 / 否」才传 use_ai=false。",
    "3) 正文优先用本地文稿库 article_id（先用 save_article 入库），其次 file_path，最后 content，避免长文本反复传输。",
    "4) 发布 / 修改前按需读资源 fanqie://publish-rules；赛道与前三章方法见 fanqie://genres、fanqie://golden-three-chapters。",
    "5) 发布成功后按返回的「下一步」提醒用户去作者后台完成签约 / 查看审核——签约与审核只能用户本人操作。",
].join("\n");
export function buildServer() {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    registerAuthTools(server);
    registerNovelTools(server);
    registerChapterTools(server);
    registerShortStoryTools(server);
    registerMicroHeadlineTools(server);
    registerLibraryTools(server);
    registerKnowledgeTools(server);
    registerStatsTools(server);
    registerResources(server);
    return server;
}
async function main() {
    ensureDirs();
    // 便于排障：--selfcheck 只打印环境信息后退出，不启动任何传输
    if (process.argv.includes("--selfcheck")) {
        const { automationReadiness } = await import("./services/auth.js");
        process.stderr.write(JSON.stringify({ ...automationReadiness(), remote: describeRemote() }, null, 2) + "\n");
        return;
    }
    // 数据落在哪儿常是排障第一问（cookies / 文稿都在里面），启动时明确报一次
    logger.info(`数据目录: ${DATA_DIR}（来源: ${DATA_DIR_SOURCE}）`);
    // 远程模式：Streamable HTTP（默认仍是 stdio，不改变现有 WorkBuddy 用法）
    if (remoteRequested()) {
        const { startRemoteServer } = await import("./http.js");
        await startRemoteServer(buildServer, { name: SERVER_NAME, version: SERVER_VERSION });
        return;
    }
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} 已就绪（stdio），共注册 30 个工具、8 个只读资源。`);
}
main().catch((e) => {
    logger.error(`启动失败: ${e.stack ?? e.message}`);
    process.exit(1);
});
