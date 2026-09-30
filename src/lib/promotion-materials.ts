/**
 * 推广素材库（唯一来源）。
 *
 * 取代原先硬编码在 `PartnerDashboard.tsx` 里的三条成品话术。三个理由：
 *
 * 1. **成品话术是负资产。** 一条文案发给 10 个推广员、10 个人一字不改地转发，
 *    是双输：朋友一眼看得出是广告（推广员和平台不共享信任，他朋友信的是"这是我朋友"），
 *    平台也会把重复内容判成低质营销。所以这里给的是**可改写的骨架**
 *    （填什么、按什么顺序说），而不是让人直接抄的成品。
 *
 * 2. **平台规则必须做进界面，不能只写在文档里。** 小红书 2025-03-12 生效的
 *    《交易导流违规管理细则》明确禁止「发布其他平台的链接、口令、截图、水印、
 *    **二维码**、小程序」，处罚可到**永久封禁账号**。而原先的复制按钮是
 *    `s.text + " " + inviteLink` —— **无条件把邀请链接拼上去**，
 *    等于平台在教推广员踩线。见 PLATFORM_RULES。
 *
 * 3. **它同时是合规留档物。** distribution-compliance.md 第八节要求留存
 *    「推广物料的审核记录」。这个模块带 `version` / `publishedAt`，
 *    是"物料审核记录"的最小可用形态（每次改动都要更新版本号）。
 *
 * ⚠️ 禁用词表来自 distribution-compliance.md 第七节（最高检文中要求平台在
 * 直播间/小程序做敏感词拦截）。**新增素材前先跑单测**
 * `src/__tests__/promotion-materials.test.ts`，它会挡住禁用词。
 *
 * 纯模块、无服务端依赖：客户端组件直接用。
 */

/** 素材库版本。每次改动素材都必须更新，否则留档失去意义。 */
export const PROMOTION_MATERIALS_VERSION = "2026-10-01"

export const PROMOTION_MATERIALS_PUBLISHED_AT = "2026-10-01"

/**
 * 禁用词（distribution-compliance.md 第七节）。
 *
 * 分三类，来源不同：
 *   · 收益承诺类 —— 最高检明确列为高危宣传（"零风险""一年回本"）
 *   · 传销结构类 —— 出现即说明结构可能有问题，不只是文案问题
 *   · 缴费入门类 —— 命中《禁止传销条例》第七条(二)的"变相入门费"表述
 */
export const BANNED_WORDS = [
  // 收益承诺
  "零风险",
  "稳赚",
  "躺赚",
  "月入过万",
  "一年回本",
  "包赚",
  "保底收益", // 协议里也禁止承诺"保底收益"
  // 传销结构
  "拉人头",
  "发展下线",
  "团队计酬",
  "层级返利",
  "无限代",
  "见点奖",
  "对碰奖",
  "直推奖",
  // 缴费入门
  "加盟",
  "代理费",
  "门槛费",
  "保证金",
] as const

/**
 * 找出文案里的禁用词。
 *
 * 用 `includes` 而不是分词：禁用词表是**短语义串**，而中文没有空格分词，
 * 按词切反而会漏（"月入过万"被切成"月入"/"过万"就匹配不到了）。
 * 代价是会误报（比如"加盟店"里含"加盟"），但这个方向的误报是可接受的 ——
 * 宁可让人改写一句，也不要漏掉一个。
 */
export function findBannedWords(text: string): string[] {
  return BANNED_WORDS.filter((w) => text.includes(w))
}

export interface PlatformRule {
  /** 平台名，同时用作 UI 分组键 */
  platform: PromotionPlatform
  /** 能不能在内容里放落地链接 */
  linkAllowed: boolean
  /** 能不能放二维码 / 带二维码的海报 */
  qrAllowed: boolean
  /** 硬规则说明（给推广员看的原文口径） */
  note: string
  /** 这条规则依据的规则名与生效时间；界面要显示，让人知道会过时 */
  asOf: string
}

/**
 * 分平台红线。
 *
 * `asOf` 必须显示在界面上：平台规则会变，一张不标日期的"红线表"比没有更危险
 * （推广员会以为它永远有效）。
 */
export const PLATFORM_RULES: PlatformRule[] = [
  {
    platform: "小红书",
    linkAllowed: false,
    qrAllowed: false,
    note:
      "《交易导流违规管理细则》禁止「发布其他平台的链接、口令、截图、水印、二维码、小程序」，" +
      "以及「引导用户查看、添加、提供、交换私域信息」。处罚从警告到限制直播、直至永久封禁账号。" +
      "所以在这里只能靠内容本身有价值，让用户自己去搜「码上英语」——不要放链接、不要放二维码、" +
      "也不要在评论区和私信里引导。",
    asOf: "小红书《交易导流违规管理细则》· 2025-03-12 生效",
  },
  {
    platform: "抖音",
    linkAllowed: false,
    qrAllowed: true,
    note:
      "站外导流与「宣导返利」类内容受平台管控，直播间口播引导到站外尤其敏感。" +
      "短视频与直播间以学习内容本身为主，导流走粉丝群/私信等站内通道；" +
      "具体尺度请以抖音最新规则为准，不要照搬其他平台的做法。",
    asOf: "抖音站外推广违规管理规则（持续修订中，需定期复核）",
  },
  {
    platform: "微信",
    linkAllowed: true,
    qrAllowed: true,
    note:
      "朋友圈与私聊是唯一可以自由放链接和二维码的地方，也是转化率最高的场景。" +
      "但要注意：微信《运营规范》禁止以奖励诱导关注，所以不要在文案里写" +
      "「关注送会员」之类的话。",
    asOf: "微信外部链接内容管理规范 · 微信公众平台运营规范",
  },
]

export type PromotionPlatform = "小红书" | "抖音" | "微信"

export interface PromotionMaterial {
  id: string
  platform: PromotionPlatform
  /** 使用场景，显示给推广员 */
  scene: string
  /**
   * 可改写骨架：每一步该说什么，**不是成品文案**。
   * 推广员按这个结构用自己的话写，才不会被识别成广告。
   */
  skeleton: string[]
  /** 示例：演示怎么把骨架写成一个人说的话 */
  example: string
  /** 为什么这样写。这段同时是给推广员的培训内容 */
  why: string
  /** 这个场景里绝对不能做的 */
  avoid: string[]
}

/**
 * 素材全集。
 *
 * 排序即优先级：微信私聊/朋友圈排在最前，因为它们**没有平台导流限制**，
 * 是唯一能把人直接带到产品的场景 —— 而小红书/抖音只能做"内容种草 + 自己去搜"。
 * 推广员的时间应该先花在转化率最高的地方。
 */
export const PROMOTION_MATERIALS: PromotionMaterial[] = [
  {
    id: "wechat-dm",
    platform: "微信",
    scene: "私聊（最优先）",
    skeleton: [
      "先说**你自己**的真实感受，一句话，具体到某个细节（别说「很好用」）",
      "说清楚它解决的是什么问题 —— 你身上真实存在的那个问题",
      "给出邀请链接，并说明是免费注册、不用先付费",
    ],
    example:
      "我之前背单词总是背完就忘，后来改用这个码上英语，是打中文、敲英文那种练法，" +
      "每句都有音标和词性拆解，练了大概两周，写东西的时候句子能直接出来了。" +
      "你要不要试试，用我这个链接注册就行，免费的：{邀请链接}",
    why:
      "私聊是一对一场景，对方会认真读，所以**细节**比形容词有用。" +
      "「背完就忘」是你自己的问题，也是他大概率有的问题 —— 从共同问题切入，比从产品功能切入自然得多。",
    avoid: [
      "不要群发。同一条消息发给 50 个人，会被举报并被微信限制。",
      "不要一上来就发链接，先说事。",
      "不要承诺收益或说「帮我冲个业绩」。",
    ],
  },
  {
    id: "wechat-moments",
    platform: "微信",
    scene: "朋友圈",
    skeleton: [
      "配一张**你真实练习的截图**（有你的成绩/进度那种）",
      "正文写你今天练到的内容或一个小发现",
      "链接放在**评论区**而不是正文（正文放链接会被降权）",
    ],
    example:
      "今天练到一句「I'm swamped with work」，才发现老外说「忙死了」根本不提 busy。[配图]\n" +
      "链接放评论区了，想试的可以看看。",
    why:
      "朋友圈的信任来自「你真的在用」。截图是**证据**，比任何文案都强。" +
      "正文讲一个具体的小发现，是在给别人提供价值，不是在打广告。",
    avoid: [
      "不要在正文放链接（会被折叠/降权）。",
      "不要连续多天发同类内容，会被当营销号。",
      "不要晒佣金收入来招募 —— 那会把经营对象从「卖课」变成「卖赚钱机会」，" +
        "见 docs/distribution-compliance.md。",
    ],
  },
  {
    id: "xiaohongshu-note",
    platform: "小红书",
    scene: "学习笔记",
    skeleton: [
      "标题写**具体的学习成果或方法**，不要出现产品名（例如「背单词总忘，我换了个笨办法」）",
      "正文讲方法/过程，产品作为「我用的工具」顺带出现一次",
      "结尾不引导、不放链接、不放二维码；让人自己搜",
    ],
    example:
      "背单词总忘，我换了个笨办法：不再背单词，改成打整句。\n" +
      "就是把中文句子敲成英文，一句一句来，错的地方它会拆开讲音标和词性。\n" +
      "练了半个月，最大的变化是写邮件不用先想中文了。\n" +
      "（我用的是码上英语，搜名字就有）",
    why:
      "小红书的算法奖励**有用的内容**，不奖励广告。所以这篇的主体是「一个方法」，" +
      "产品只是「我用它做到的」。这样即使不引流，笔记本身也能拿到自然流量 —— " +
      "而直接发广告的笔记通常拿不到。",
    avoid: [
      "⚠️ 不要放链接、网址、二维码、含二维码的截图/海报、其他平台账号 —— " +
        "《交易导流违规管理细则》明令禁止，处罚可到永久封禁账号。",
      "不要在评论区或私信引导加微信/进群（同属违规类型）。",
      "不要出现产品名做标题（容易被判营销笔记限流）。",
    ],
  },
  {
    id: "douyin-video",
    platform: "抖音",
    scene: "短视频 / 学习直播",
    skeleton: [
      "前 3 秒给一个**具体场景**（比如一句你以前绝对说不出的英文）",
      "中段演示你怎么练的（录屏，可以用码上英语的界面）",
      "结尾说「想一起练的可以搜码上英语」，不在口播里放链接",
    ],
    example:
      "今天练会一句：'Let me sleep on it.' —— 意思是「让我考虑一晚」，不是「睡在上面」。\n" +
      "{录屏：把中文敲成英文的过程}\n" +
      "我每天用码上英语练 10 分钟，想一起练的搜名字就行。",
    why:
      "抖音按完播率分发，所以开头必须立刻给价值。录屏是内容本身（可以一直用下去），" +
      "不需要额外拍摄成本。",
    avoid: [
      "不要在直播里招募推广员、讲佣金或「跟着我赚钱」 —— 直播间是被重点审查的场所，" +
        "且会改变你的经营对象定性，见 docs/distribution-compliance.md 第七节。",
      "不要在口播或简介里放站外链接（抖音管控站外导流）。",
      "不要承诺收益、不要用任何禁用词。",
    ],
  },
]

/** 取某个平台的素材 */
export function materialsForPlatform(platform: PromotionPlatform): PromotionMaterial[] {
  return PROMOTION_MATERIALS.filter((m) => m.platform === platform)
}

/** 取某个平台的规则；找不到时返回 null，调用方必须处理（不要假装有规则）。 */
export function ruleForPlatform(platform: PromotionPlatform): PlatformRule | null {
  return PLATFORM_RULES.find((r) => r.platform === platform) ?? null
}

/**
 * 这个场景能不能在文案里附上邀请链接。
 *
 * 复制按钮**必须**先问这个函数 —— 原先的 `text + " " + inviteLink` 是
 * 无条件拼接，在小红书就是直接违规。
 */
export function canAttachLink(platform: PromotionPlatform): boolean {
  return ruleForPlatform(platform)?.linkAllowed ?? false
}

/**
 * 把一段文案 + 可选链接合成最终要复制的内容。
 *
 * 平台不允许放链接时**不拼链接**，并在结果里如实告诉调用方，
 * 这样界面可以提示"已省略链接，请引导用户搜索"而不是静默丢数据。
 */
export function buildCopyText(
  text: string,
  platform: PromotionPlatform,
  inviteLink: string,
): { text: string; linkIncluded: boolean } {
  if (canAttachLink(platform)) {
    return { text: `${text}\n${inviteLink}`, linkIncluded: true }
  }
  return { text, linkIncluded: false }
}
