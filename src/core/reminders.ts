/**
 * 发布类工具成功后的「人工下一步」提醒。
 *
 * 签约 / 审核都只能在作者后台由本人完成（涉及合同与实名），MCP 不做也不代做。
 * 建书、发章、发短篇、发微头条成功后必须带上，否则用户会以为工具已把流程走完。
 * ⚠️ 只在「真的提交了」的分支拼这些文案；confirm=false 的预览不要带。
 */
export const NEXT_STEP_BOOK_CREATED =
  "📌 下一步（MCP 不代做）：到作者后台「作品信息 → 签约」申请签约——未签约作品不上推荐、无收益。";

export const NEXT_STEP_CHAPTER_PUBLISHED =
  "📌 下一步（MCP 不代做）：章节已提交，审核状态到作者后台「章节管理」查看；作品还没签约的，先去「作品信息 → 签约」申请。";

export const NEXT_STEP_SHORT_PUBLISHED =
  "📌 下一步（MCP 不代做）：短故事已提交，审核结果与签约邀请以作者后台「短故事」列表 / 站内信为准。";

export const NEXT_STEP_WTT_PUBLISHED =
  "📌 下一步（MCP 不代做）：微头条已提交，推荐与审核结果在作者后台「作品推荐」查看。";
