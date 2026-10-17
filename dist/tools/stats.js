import { z } from "zod";
import { fromService } from "../core/result.js";
import { getStats } from "../services/stats.js";
export function registerStatsTools(server) {
    server.registerTool("get_stats", {
        title: "汇总统计",
        description: "汇总本地文稿库/任务/登记 + 环境自检；remote=true 时再读一次番茄后台的真实小说与短故事列表。",
        inputSchema: {
            remote: z.boolean().optional().describe("是否联网读取后台数据，默认 false"),
            headless: z.boolean().optional().describe("远程读取是否无头运行，默认 true"),
        },
    }, async ({ remote, headless }) => fromService((await getStats({ remote, headless }))));
}
