/** 本地文稿库条目（用户写好的正文，MCP 只负责入库与上传） */
export interface Article {
  id: string;
  /** chapter=小说章节；short=短故事正文 */
  kind: "chapter" | "short";
  title: string;
  content: string;
  wordCount: number;
  /** chapter 归属的本地小说 id */
  novelId?: string;
  /** chapter 的章节号 */
  chapterNumber?: number;
  /** 短故事：长度上限校验用 */
  status: "draft" | "published" | "failed";
  /** 番茄书 id（小说） */
  tomatoBookId?: string;
  /** 番茄短故事 item_id */
  tomatoItemId?: string;
  publishTime?: string;
  /** 最近一次发布的说明/错误 */
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** 本地小说登记（用于给建书/发章提供默认值，并绑定番茄书 id） */
export interface Novel {
  id: string;
  title: string;
  /** 频道：1=男频，0=女频 */
  gender: number;
  author?: string;
  abstract?: string;
  protagonist1?: string;
  protagonist2?: string;
  /** 番茄作者后台书 id */
  tomatoBookId?: string;
  tomatoBookName?: string;
  readingTags?: string[];
  contentTags?: { plot?: string[]; emotion?: string[]; character?: string[]; worldview?: string[] };
  createdAt: string;
  updatedAt: string;
}

/** 本地短故事登记 */
export interface ShortStory {
  id: string;
  title: string;
  abstract?: string;
  category?: string;
  signType?: number;
  /** 番茄 short_article item_id */
  tomatoItemId?: string;
  status: "draft" | "published" | "failed";
  createdAt: string;
  updatedAt: string;
}

/** 发布任务日志 */
export interface PublishTask {
  id: string;
  kind: "novel" | "chapter" | "short";
  targetId?: string;
  title?: string;
  status: "pending" | "done" | "failed";
  mode: "upload" | "batch";
  message?: string;
  scheduledTime?: string;
  screenshotPath?: string;
  createdAt: string;
  updatedAt: string;
}
