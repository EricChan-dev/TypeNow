# 功能实施计划（2026-09-29）

> 依据：本轮对话中已确认的 7 项决策 + 代码/生产库实测结果。
>
> **执行方式已确认：一次全做完，中途不汇报。** 本文档是执行前的完整设计；
> 内部仍按 §5 的顺序推进并持续跑测试（这不是汇报，是让失败可定位）。
>
> **⚠️ 有一件事我无法替你做：生产库 DDL 必须手工执行**（`CLAUDE.md`：
> 「迁移是手工执行的，仓库没有迁移执行器，部署脚本不含 SQL 步骤」）。
> 见 §7。

---

## 0. 完成记录（2026-09-29）

**9 项改动全部实现；4 个迁移与教材版本回填已在生产库执行完毕。**

| 验证手段 | 结果 |
|---|---|
| `pnpm test`（单测） | **953 / 953 通过**（64 文件） |
| `npx vitest run --config vitest.e2e.config.ts` | **474 / 474 通过**（27 文件） |
| `npx tsc --noEmit` | **零错误** |
| 改动文件 lint 增量（HEAD vs NOW） | **全部零增量**（1 个文件还减少 1 条） |
| 生产库 DDL + 回填 | **4 个迁移 + 194 门课回填已执行，逐项校验通过**（见 §0.3） |

| 目标项 | 状态 | 落地位置 |
|---|---|---|
| ① 试学 5 句 | ✅ | `lib/free-trial.ts`（价格页文案自动跟随） |
| ② 体验会员 3 天 | ✅ | `lib/trial-days.ts` |
| ③ 邀请天数（注册 5 天 / 首购月季 3 天 / 年卡 7 天 / 终身不参与） | ✅ | `lib/invite-rules.ts` |
| ④ 金币体系 | ✅ | `lib/coins.ts` + `/api/coins/earn` + `coin_logs` 表 |
| ⑤ 打卡门槛＝当日练习句数（默认 10、可自设）并发金币 | ✅ | `api/home/check-in` + `lib/coins.ts` |
| ⑥ AI 额度（免费 3 / 会员 20 / 会员每日赠 30 钻） | ✅ | `lib/membership-benefits.ts` + `lib/member-grant.ts` |
| ⑦ 定价四档 + 首期优惠（原价＝真实续费价） | ✅ | `lib/pricing.ts`（唯一事实源）+ 支付链路贯通 |
| ⑧ 合规解绑 | ✅ | `subscription.ts` 准入 + 4 个 partner 路由改为「协议同意」门禁 + `/api/partner/join` 留档 + 协议与全站文案 |
| ⑨ 教材同步 | ✅ | `lib/textbook-taxonomy.ts` + `api/courses/textbook-facets` + `/home/textbook` 三级筛选 + 回填脚本 |

### 0.1 上线步骤（①②④ 已完成，只剩 ③ 部署代码）

```bash
# ① 备份 —— ✅ 已完成
#    db-backup/pre-00027-00030-20260929-171602/
#    6 张表结构快照 + 5 张小表全量数据 + 194 门同步课清单 + 执行前基线

# ② 按序执行 4 个迁移 —— ✅ 已完成，逐项校验通过（见 §0.3）
mysql "$DATABASE_URL" < db/migrations/00027_coins.sql
mysql "$DATABASE_URL" < db/migrations/00028_member_daily_grant.sql
mysql "$DATABASE_URL" < db/migrations/00029_quarterly_plan.sql
mysql "$DATABASE_URL" < db/migrations/00030_textbook_version.sql

# ③ 部署新代码 —— ❌ 还没做。当前线上是「旧代码 + 新表结构」

# ④ 教材版本回填 —— ✅ 已完成（194/194，0 个 NULL）
npx tsx scripts/backfill-textbook-version.ts           # dry-run，产出 content-textbook-version.json
npx tsx scripts/backfill-textbook-version.ts --apply   # 写库
```

> 部署前的一个临时差异（不是故障）：线上旧代码把 `check_in_goal` 当"当日钻石数"，
> 而新数据是 10（原 50），所以**打卡比预期更容易**。部署后即恢复正确语义。

> 生产库实测：`school_sync` 共 194 门课，**120 门（62%）能从标题认出教材版本**，
> 其余 74 门归入「其他版本」（认不出就不猜）。回填脚本还在 JSON 里产出两份复核清单
> —— 「疑似非教材同步」7 门与「没有年级」11 门，**都不会被自动改库**。

### 0.2 与初稿不同的三处设计（执行中的修正）

1. **打卡门槛复用 `check_in_goal` 而不是新增列**。字段名本来就是「打卡目标」，
   语义被写歪了；新增列会让「用户自设目标」这个功能无处安放。见 §2.2。
2. **partner 路由的门禁改成 `partner_agreed_at`（免费同意协议）而不是完全去掉**。
   完全无门禁会让「同意协议」变成可选，那份留档就失去意义。
3. **练习时长 `duration_seconds` 从 `diamond_logs` 搬到 `coin_logs`**。
   它只在领奖请求里上报（`practice_records` 没有这一列），而首页热力图在读它；
   不搬的话统计会变成 0。响应字段名未变，所以前端无需改动。

### 0.3 执行生产 DDL 时发现并修掉的问题

这三件事都是**跑真实数据才暴露的**，本地测试与代码审查都看不出来。

**① 教材版本表漏了两个真实出版社。**

dry-run 扫 194 条生产标题时，发现「认不出」的标题里出现了 `仁爱新版七年级上册` 与
`【科普版】八年级下册【课本同步】`——仁爱版（北京仁爱教育研究所）与科普版
（科学普及出版社）都是真实教材，我的第一版版本表没有它们。
已补进 `lib/textbook-taxonomy.ts` 并加真实标题单测；可识别率从 59% 提到 62%。

> 这就是回填脚本默认 dry-run 的意义：**版本表不可能靠想象列全**，必须让真实数据说话。

**② 18 门课在教材同步页完全不可见。**

执行后按 `sub_category_key` 分组核对，发现两个漏网的分组：

| 分组 | 课程数 | 第一版学段是否覆盖 |
|---|---|---|
| `grade_1..9` + `high_school` | 176 | ✅ |
| `vocational`（中职英语） | 7 | ❌ 漏了 |
| `sub_category_key IS NULL` | 11 | ❌ 无入口 |

`vocational` 本来就写在 `COURSE_CATEGORIES`（`types/course.ts`）里，是我建学段时漏的。
已加「中职」学段，并为无年级课程加「未分级」分组（`UNGRADED_STAGE_KEY`，
刻意**不进 `STAGES`**——它不是真学段，不该污染 `stageOfGrade` 的语义）。

现在 194 门课全部分组：小学 114 / 初中 52 / 高中 10 / 中职 7 / 未分级 11。
这 11 门的真实年级多数能从标题判断，但**改年级是内容归类变更**，只产出清单不擅自改。

**③ 订单有效期用了两个时钟。**

`expires_at` 原来是 `new Date(Date.now() + 2h)`（应用进程时钟），
而 `created_at` 是数据库的 `CURRENT_TIMESTAMP`——两个钟，中间还夹着一次 INSERT 的往返。
sub-second 相位让 `TIMESTAMPDIFF(MINUTE, ...)` 偶尔截断成 119 分钟，
e2e 那条「订单有效期是下单后 2 小时（口径必须与 created_at 一致）」因此偶发失败。

改为同一个 INSERT 语句里的 `DATE_ADD(NOW(), INTERVAL 2 HOUR)`——语句级 `NOW()`
与列默认值同源，差值**恒为 7200 秒**；断言同时从分钟级加强到秒级。

> 诚实说明：这个偏差在生产上只有亚秒级、实际无害。它的价值在于
> ①消掉了一个随机失败的测试，②让「两个时间戳同源」这个被明确写进测试名的
> 契约真正成立。同类还有 `availableAt`（15 天冷静期）与 `proExpires`，
> 但周期是天级、偏差亚秒级，**刻意没动**——不为理论问题改支付路径。

### 0.4 明确推迟（不在本次范围）

`is_partner` / enum `partner` 重命名、打卡「手动领取 + 当天作废」、补签卡与礼品兑换、
自动续费、大学教材同步、高中拆高一/高二/高三 —— 理由见 §6。

---

## 1. 已确认决策（7 项）

| # | 议题 | 决策 |
|---|---|---|
| 1 | 金币数值 | 打卡 **+10**（连续每日 +2，封顶 +30）；练习每句 **+1**、完美 **+2**；课时 **+20**；课程 **+100**；**1000 金币 = 1 天会员**，每人每月上限 **3 天** |
| 2 | AI 额度 | 免费用户每日 **3 次免费**（服务端限流）；金币**不**参与 AI；钻石只由会员赠送与未来充值 |
| 3 | 定价 | 现价 **29/79/199/499**；原价 = **真实续费价 39/109/299/699**；首期优惠**只给新用户首次购买**，续费按原价 |
| 4 | 终身会员与邀请 | 终身会员**不参与**邀请天数奖励 |
| 5 | 教材同步范围 | 只做**小学/初中/高中**（年级 + 版本双筛选）；大学/考研保留在「应试考试」既有入口 |
| 6 | 版本数据 | 规则 + AI 从标题解析，认得出就写，认不出归「其他版本」；同时把明显非教材同步的课移出 grade_N |
| 7 | 执行方式 | 一次全做完，中途不汇报 |

---

## 2. 核实结论：**不用做的** 与 **会坏的**

### 2.1 P0-2 / P0-3 已经做完了，不要再做

| 原计划项 | 实测状态 | 证据 |
|---|---|---|
| P0-2 试用按手机号一次性 | ✅ **已完成** | `db/migrations/00012_trial_claim.sql`（含存量回填）；`users.phone` 是 UNIQUE 且注册是 find-or-create → 「每账号一次」天然等于「每手机号一次」；`lib/trial.ts:54` 用条件更新 + affectedRows 保证幂等 |
| P0-3 体验会员领取弹窗 | ✅ **已完成** | `src/components/home/WelcomeTrialModal.tsx` 已存在；`api/auth/me` 返回 `trial_available`，`api/courses/sentences` 返回 `trialAvailable` |

**所以本轮 P0-2 / P0-3 的工作量是 0。** 只剩一处数值调整：`TRIAL_DAYS` 5 → 3（§4.2）。

### 2.2 🔴 会直接坏掉的功能：打卡

```ts
// src/app/api/home/check-in/route.ts（现状）
SELECT SUM(amount) FROM diamond_logs WHERE userId=? AND DATE(createdAt)=today
if (todayDiamonds < checkInGoal) return 403 { error: "need_more_diamonds" }
```

打卡门槛判的是**当日钻石总量 ≥ `check_in_goal`（默认 50）**。
一旦练习奖励改发金币（决策 2），`diamond_logs` 不再新增 → **当日钻石恒为 0 → 打卡永久失败。**

**句乐部怎么做的**（官方文档 `julebu.co/docs/guide-tasks-coins` 原文）：

> **每日打卡**：完成当天的打卡目标就算完成（**打卡目标可以自己设，默认 10 个练习点**）

| | 句乐部 | TypeNow 现状 |
|---|---|---|
| 门槛判什么 | **「练习点」——学习量** | 当日**钻石数**（货币） |
| 默认值 | **10**，**用户可自设** | 50，无设置入口 |
| 打卡奖励 | **金币**（每日任务里手动点「领取」） | **无** |

**病根清楚了**：`users.checkInGoal` 这个字段名本来就是「打卡目标」（对应句乐部的概念），
但代码把它实现成了「当日钻石数 ≥ 50」。**字段名是对的，语义被写歪了。**

**修法（已定）**：**恢复 `check_in_goal` 的原意**，不新增列。

| 项 | 现在 | 改成 |
|---|---|---|
| 语义 | 当日**钻石数** | 当日**练习句数**（= 句乐部的「练习点」） |
| 默认值 | 50 | **10**（对齐句乐部） |
| 数据来源 | `diamond_logs` | `practice_records` |
| 用户自设 | ❌（字段在，无入口） | ✅ 设置页可改 |
| 奖励 | 无 | **金币**（+10，连续每日 +2，封顶 +30） |

> **为什么门槛用句数而不是金币**：若门槛判「当日获得金币」，而打卡奖励本身发金币，
> 就会出现**打卡奖励依赖打卡是否成立**的循环。句数是独立、无法用登录刷的量。
>
> **为什么复用 `check_in_goal` 而不是新增列**（此处推翻了本文档初稿的建议）：
> 字段名本来就叫「打卡目标」，语义恢复后它是自洽的；而新建一列会让「用户自设打卡目标」
> 这个句乐部已验证的功能**无处安放**。存量数据 `UPDATE ... = 10 WHERE = 50`，
> 当前 <100 用户、0 付费，迁移风险为零。
>
> **句乐部的「手动领取 + 当天不领作废」本轮不抄**。它会制造第二次访问（学完还得回来
> 点一下，不点就损失），是有效的留存机制，但需要「任务列表 + 领取状态」一整套基础设施。
> 本轮先做**自动发放**，该机制列入 §6 推迟项。

### 2.3 🔴 与你的决策冲突的现有常量

| 常量 | 现值 | 必须改成 | 为什么 |
|---|---|---|---|
| `FREE_AI_CHAT_PER_DAY` | **0** | **3** | 现值是「免费用户 0 次」，与决策 2 直接冲突 |
| `PRO_AI_CHAT_PER_DAY` | **2** | **20** | 见下 |

`membership-benefits.ts` 有一条**单测强制的约束**（文件头注释第 22-26 行）：
`quota` 类权益必须 **`proPerDay > freePerDay`**。
把 `FREE_AI_CHAT_PER_DAY` 从 0 改成 3 之后，`PRO_AI_CHAT_PER_DAY = 2` **会立刻让单测失败**。

**句乐部怎么做的**（官方文档 `julebu.co/docs/membership` 原文）：

> **AI 助手**：超出每日 **2 次**免费提问后，每次提问消耗少量钻石
>
> 会员每月会自动获得免费钻石（月度、季度、年度会员 **10,000 颗**，永久会员 15,000 颗），
> 在会员周期开始日重置。

**所以根因是「误抄」**：句乐部的 `2 次` 是**给所有人的**（含免费用户），
TypeNow 把它抄到了 **PRO** 上、同时把免费设成 0 —— **数字抄对了，归属抄错了**。

句乐部真正的会员 AI 优势不是「更多每日免费次数」，而是**每月 10,000 钻**。

**我们的等价设计**：不做「每月 1 号发一大笔」（那需要定时任务，而本仓库没有，
见 `commission-safety.ts:11`），改为 **每日懒发放**：

| 常量 | 值 | 说明 |
|---|---|---|
| `FREE_AI_CHAT_PER_DAY` | 3 | 所有人每日免费（句乐部 2，我们稍宽松） |
| `PRO_AI_CHAT_PER_DAY` | 20 | 会员每日免费更高 |
| `MEMBER_DAILY_DIAMONDS`（新增） | 30 | 会员每日赠钻，懒发放，靠唯一索引幂等 |

> 为什么会员既「每日免费 20 次」又「每日赠 30 钻」而不学句乐部发 10,000 钻/月：
> `membership-benefits.ts` 对 `ai-analyze`（免费 30 / 会员 200）与 `pronunciation`
> （免费 3 / 会员 30）**本来就是「会员更宽」的模式**，`ai-chat` 用同一模式保持内部一致。
> 成本：会员每天 20 免费 + 30 钻（÷5 = 6 次）= 26 次 × ¥0.007 ≈ **¥5.5/月**，
> 占 ¥29 月卡 19%。全部在单个常量里，可调。

### 2.4 🟠 合规解绑会牵动定价页的数据结构

`membership-benefits.ts` 里有两处把**推广权益挂在付费商品上**，正是
[distribution-compliance.md](distribution-compliance.md) §二 认定的「经营对象」风险点：

| 位置 | 现状 | 要改成 |
|---|---|---|
| `PARTNER_BENEFITS`（6 条） | 邀请链接/佣金 50%/续费 30%/提现/看板 **全部**属于付费档 | **拆成两张表**：`LIFETIME_BENEFITS`（只剩「永久解锁全部功能」）+ `PROMOTER_BENEFITS`（免费，所有人可加入） |
| `COMPARISON_ROWS` | 「邀请链接/海报」「首次付款佣金 50%」「续费佣金 30%」「提现」4 行挂在 partner 列 | **从付费对比表移除**，改为表下一行不分档说明：「所有注册用户均可免费加入推广计划」 |

**句乐部怎么做的**（官方文档 `julebu.co/docs/membership` + `guide-promotion-rewards`）：

| | 句乐部 |
|---|---|
| **星火计划入口** | **网站首页左下角点「推广返佣」→ 报名参与**。独立入口，**不在会员购买页** |
| 谁能加入 | **免费报名**。不付钱也能推广拿佣金（月 50% / 季 40% / 年 30% / 永久 ¥500） |
| 付费档带来的差别 | 月/季/年 = 「可参加星火计划」；**永久会员 = 「更高返佣比例 + 永不淘汰」** |

所以句乐部的结构是：**推广资格免费取得**（不付钱也能推广），
付费只是让已是客户的永久会员拿**更高**的佣金比例。
这与哇学社「不付 ¥1299 就不能推广」本质不同 —— 句乐部的「取得资格」没有收费。

> **我们比句乐部再保守一层，明确不抄「永久会员更高返佣」。** 这一步是为了彻底避开
> 最高检列的「购买礼包解锁更高佣金」灰色描述。代价是永久档少一个卖点，
> 收益远小于风险 —— 你现在 <100 用户、0 付费，没有任何存量权益需要保护。

### 2.5 🟠 三处 ENUM 需要 DDL

| 表 | 现状 | 要加 |
|---|---|---|
| `subscriptions.plan` | `monthly / yearly / partner` | `quarterly` |
| `payment_orders.plan` | 同上 | `quarterly` |
| `diamond_logs.type` | `sentence / lesson_complete / course_complete / share_invite / chat` | `member_grant` |

> **`enum` 值 `partner` 本轮保持不改名。** 理由：本轮改动面已经很大（新表 + 4 处 DDL + 支付 + UI），
> 再叠加一次纯重命名（涉及 DB 列名、enum 值、约 10 处 UI 引用）会显著抬高出错概率，
> 而重命名不产生任何用户价值。**改为加显式注释 + 列为后续独立任务**（§6）。

### 2.6 顺带核实到的其他事实

- **练习奖励的服务端权威判定是资产，必须原样保留**：`api/diamonds/earn` 不采信客户端的
  `perfect`/`streak`，靠 `practice_records` 反推，并用唯一约束 + 行锁保证幂等。改金币时**只改奖励货币，不动判定逻辑**。
- **AI 对话已有日额度基础设施**：`ai_chat_logs.used_free_quota` 已在记录「是否走了免费额度」，
  所以免费额度从 0 改成 3 不需要新表，只需改判定。
- `diamonds/earn` 的调用点只有 2 处，都在 `LearnClient.tsx`（713、1615 行）。
- 课程广场在 `src/app/home/store`（`CourseTabs.tsx` 用 `COURSE_CATEGORIES` 渲染）。

### 2.7 🟡 一处你的设计**偏离**了句乐部，需要你知道

你定了 **1000 金币 = 1 天会员**。句乐部刻意**不这么做**（官方文档 `guide-tasks-coins` + `membership`）：

> 两种货币用途完全不交叉，**且都不能兑换会员**。
> 金币只能买**补签卡**（忘了打卡就补上，连胜不断，无使用次数限制）、**改名卡** —— 都是体验优化类道具。

| | 金币来源 | 日上限 | 能否换会员 |
|---|---|---|---|
| 句乐部 | **只有每日任务领取**（4 个任务） | ✅ 天然有 | ❌ **刻意不行** |
| 本方案 | 每日任务 **+ 练习每句 +1**（线性） | ❌ 无 | ✅ 1000 金币 = 1 天 |

把「线性无上限产出」与「能换会员」叠加，理论上可以刷句子换会员。
**这不一定要改** —— 「练 1000 句换 1 天会员」正是产品要鼓励的行为，
而且**每月 3 天上限已兜住最坏情况**。

**两条执行纪律（验收条件，不是建议）**：
1. **每月 3 天上限必须服务端强制** —— 前端拦等于没拦
2. 兑换走**行锁 + 余额校验**，沿用 `lib/trial.ts:35` 的条件更新模式

> **已确认保留「金币换会员」**，按上面两条纪律执行。
> 若将来想更贴近句乐部：金币只换道具，会员天数只靠邀请奖励 —— 那样金币永不侵蚀付费收入。

---

## 3. 数据结构变更

### 3.1 DDL（4 个迁移文件）

**`00027_coins.sql` — 金币体系**

```sql
-- 金币余额。钻石（付费货币）与金币（免费货币）严格分离，
-- 用途不交叉：金币只能换会员天数/道具，永远不能换 AI 调用（那是真金白银）。
ALTER TABLE users ADD COLUMN coins INT NOT NULL DEFAULT 0;

CREATE TABLE coin_logs (
  id         VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id    VARCHAR(36) NOT NULL,
  amount     INT NOT NULL,          -- 正=获得，负=消耗
  type       ENUM('check_in','sentence','lesson_complete','course_complete',
                  'share_invite','redeem_membership','redeem_item') NOT NULL,
  ref_id     VARCHAR(36) NULL,
  streak     INT NOT NULL DEFAULT 0,
  date       VARCHAR(10) NOT NULL,  -- 上海日历日，用于每日统计与上限判定
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coin_logs_user_id (user_id),
  INDEX idx_coin_logs_user_created (user_id, created_at),
  INDEX idx_coin_logs_user_date (user_id, date)
);

-- 打卡门槛语义恢复：check_in_goal 从「当日钻石数」恢复为「当日练习句数」
-- （对应句乐部的「打卡目标」，默认 10 个练习点，用户可自设）。
-- 为什么不新增列：字段名本来就是「打卡目标」，是被写歪了，不是缺字段；
-- 新增列会让「用户自设打卡目标」这个句乐部已验证的功能无处安放。见 §2.2。
ALTER TABLE users MODIFY COLUMN check_in_goal INT NOT NULL DEFAULT 10;
-- 实测生产库 26 个用户全部是 50（旧语义），回填为新的默认目标
UPDATE users SET check_in_goal = 10 WHERE check_in_goal = 50;
```

**`00028_member_daily_grant.sql` — 会员每日赠钻的幂等键**

```sql
ALTER TABLE diamond_logs
  MODIFY COLUMN type ENUM('sentence','lesson_complete','course_complete',
                          'share_invite','chat','member_grant') NOT NULL;

-- 每日赠钻只对 type='member_grant' 的行写 grant_day，靠唯一索引保证一天只发一次。
-- 复用 task_logs.share_day 的同一套手法（MySQL 唯一索引允许多个 NULL，
-- 所以其余类型的行不受影响）。
ALTER TABLE diamond_logs ADD COLUMN grant_day VARCHAR(10) NULL;
CREATE UNIQUE INDEX uk_diamond_grant_day ON diamond_logs (user_id, grant_day);
```

**`00029_quarterly_plan.sql` — 季度档**

```sql
ALTER TABLE subscriptions
  MODIFY COLUMN plan ENUM('monthly','quarterly','yearly','partner') NOT NULL;
ALTER TABLE payment_orders
  MODIFY COLUMN plan ENUM('monthly','quarterly','yearly','partner') NOT NULL;
```

**`00030_textbook_version.sql` — 教材同步**

```sql
-- 版本维度（人教版/译林版/…）。学段与年级继续由 category_key + sub_category_key 表达，
-- 不新增冗余的 textbook_stage 列 —— 冗余列会与 sub_category_key 漂移，
-- 这正是本仓库反复强调过的一类问题。
ALTER TABLE courses ADD COLUMN textbook_version VARCHAR(50) NULL;
CREATE INDEX idx_courses_textbook
  ON courses (category_key, sub_category_key, textbook_version, is_published);
```

### 3.2 schema.ts 同步

四处都要改（`db/README.md` 要求 `schema.ts` 与迁移保持同步，e2e 走
`drizzle-kit push` 从 schema 生成测试库，不同步会直接让 e2e 失败）：

`users.coins`、`users.checkInGoal`（默认值 50 → 10 + 注释里的语义变更说明）、
`diamondLogs.grantDay`、`coinLogs`（新表）、`courses.textbookVersion`、两处 plan ENUM。

---

## 4. 逐项实施清单

### 4.1 试学 5 句

| 文件 | 改动 |
|---|---|
| `src/lib/free-trial.ts` | `FREE_TRIAL_SENTENCES = 3` → `5` |
| `src/__tests__/free-trial.test.ts` | 断言更新 |

> `FREE_TRIAL_SENTENCES` 被 `membership-benefits.ts` 的 `PRO_BENEFITS`（第 99 行）
> 与 `COMPARISON_ROWS`（第 213 行）引用，改常量会**自动**同步价格页文案——无需手改文案。

### 4.2 体验会员 3 天

| 文件 | 改动 |
|---|---|
| `src/lib/trial-days.ts` | `TRIAL_DAYS = 5` → `3` |
| `src/lib/trial.ts` | 更新注释（原注释解释的是「为什么是 5 天」，要改写成「为什么回到 3 天」） |
| `src/__tests__/trial.test.ts` | `expect(TRIAL_DAYS).toBe(3)`；`trialExpiryFrom(jan30)` 的断言 `2026-02-04` → `2026-02-02` |

### 4.3 邀请天数

| 文件 | 改动 |
|---|---|
| `src/lib/invite-rules.ts` | `INVITE_REGISTER_DAYS` 7 → **5**；`purchaseReward`：`yearly` → `{7,7}`；`monthly`/`quarterly` → `{3,3}`；`partner`（终身）→ `null` |
| 同文件注释 | 原注释写「30/20 沿用此前比例」，改为记录本次决策 |
| `src/lib/auth/invite.ts` | 注释同步 |

> `purchaseReward` 的返回类型 `InvitePurchasePlan` 需从 `"monthly" | "yearly"`
> 扩展到含 `"quarterly"`。

### 4.4 金币体系（核心）

**新增**
- `src/lib/coins.ts` — 纯函数与常量（客户端也要用，**不得引 db**）：
  - `COIN_CHECK_IN_BASE = 10`、`COIN_CHECK_IN_STEP = 2`、`COIN_CHECK_IN_CAP = 30`
  - `COIN_PER_SENTENCE = 1`、`COIN_PER_PERFECT = 2`
  - `COIN_LESSON_COMPLETE = 20`、`COIN_COURSE_COMPLETE = 100`、`COIN_SHARE = 5`
  - `COINS_PER_MEMBER_DAY = 1000`、`MAX_MEMBER_DAYS_PER_MONTH = 3`
  - `checkInCoinReward(streakDays)` → 10 + 2×(streak−1)，封顶 30
- `src/app/api/coins/earn/route.ts` — 由 `api/diamonds/earn` 改造：
  **服务端权威判定逻辑（`practice_records` 反推、唯一约束、行锁）原样保留**，
  只把写入目标从 `diamond_logs` + `users.diamonds` 换成 `coin_logs` + `users.coins`
- `src/app/api/coins/redeem/route.ts` — 金币兑换：
  - `redeem_membership`：1000 金币 → `proExpires += 1 天`
  - 每月上限 3 天（查当月 `coin_logs` 中 `type='redeem_membership'` 的条数）
  - 必须**行锁 + 余额校验**（`coins >= 1000`），沿用 `trial.ts` 的条件更新模式
  - 礼品兑换仅返回「开发中」，不写库

**修改**
- `src/app/api/home/check-in/route.ts`：
  - 门槛数据源 `diamond_logs` → `practice_records`（当日练习句数 ≥ `checkInGoal`，默认 10）
  - 错误码 `need_more_diamonds` → `need_more_practice`；响应里带上
    `todaySentences` / `goal`，前端文案从「今日钻石不足」改为「今日还需练 N 句」
  - **首次**打卡成功时发金币（`checkInCoinReward(streakDays)`），幂等靠
    `check_ins` 既有 `uniqueIndex(userId, date)` —— **只在 insert 成功的分支发**
  - 设置页新增「打卡目标」输入（对应句乐部的可自设），范围 1–50
- `src/app/api/admin/users/*`、后台用户列表：`checkInGoal` 的展示文案从
  「钻石门槛」改为「每日打卡目标（练习句数）」
- `src/components/home/learn/LearnClient.tsx`：2 处 `fetch("/api/diamonds/earn")` → `/api/coins/earn`，
  结算展示从「钻石」改为「金币」
- `src/app/api/diamonds/earn/route.ts`：**删除**（调用点已全部迁移）

**文案**
- `membership-benefits.ts` 的 `INCLUDED_FOR_EVERYONE`：
  「练习即得钻石」→「**练习即得金币**」
- 打卡/任务相关 UI 文案：钻石 → 金币

### 4.5 AI 额度与会员赠钻

| 文件 | 改动 |
|---|---|
| `src/lib/membership-benefits.ts` | `FREE_AI_CHAT_PER_DAY` 0 → **3**；`PRO_AI_CHAT_PER_DAY` 2 → **20**；新增 `MEMBER_DAILY_DIAMONDS = 30` |
| `src/lib/member-grant.ts`（新） | `ensureDailyMemberGrant(userId)`：非会员直接返回；`INSERT` `diamond_logs`（`type='member_grant'`、`grant_day=` 上海日期、`amount=30`），靠 `uk_diamond_grant_day` 的 affectedRows 保证幂等（**懒发放，不引入定时任务**——本仓库没有定时任务，`commission-safety.ts:11` 已说明） |
| `src/app/api/auth/me/route.ts` | 调用 `ensureDailyMemberGrant`（每次进站补发当日份） |
| `src/app/api/chat/route.ts` | 入口也调用一次（保险）；免费额度判定从 `FREE_AI_CHAT_PER_DAY=0` 自动变为 3，无需改逻辑 |
| `COMPARISON_ROWS` | 「AI 私教助手」行：free 从「消耗钻石」改为「每天 3 次免费」 |

> **`MEMBER_DAILY_DIAMONDS = 30` 是我定的，理由与成本**：30 钻 ÷ 5 钻/次 = 6 次，
> 加上 20 次免费 = 会员每天约 26 次。按 §1.4 的 ¥0.007/次估算 ≈ **¥5.5/月**，
> 占 ¥29 月卡的 19%。**这是单个常量，你想调直接改它。**
> 之所以不写「无限次」：无限是真的成本敞口，而不是文案问题。

### 4.6 定价四档 + 首期优惠

**新增 `src/lib/pricing.ts`**（纯函数，客户端也要用 → 不得引 db）

| 档位 key | 名称 | 原价（标准价 = 真实续费价） | 首期优惠 | 省 |
|---|---|---|---|---|
| `monthly` | 月度会员 | ¥39 | **¥29** | ¥10 |
| `quarterly` | 季度会员 | ¥109 | **¥79** | ¥30 |
| `yearly` | 年度会员 | ¥299 | **¥199** | ¥100 |
| `partner` | 终身会员 | ¥699 | **¥499** | ¥200 |

> 单位是分：`3900/2900`、`10900/7900`、`29900/19900`、`69900/49900`。
> 定价参照句乐部（¥39/¥109/¥365/¥1999）——标准价全部低于或接近它，不夸张。

**修改**
| 文件 | 改动 |
|---|---|
| `src/lib/wechat-pay.ts` | `getPlanAmount(plan)` → `getPlanAmount(plan, isFirstPurchase: boolean)`；`plan` 类型加 `"quarterly"`；`getPlanDescription` 加季度档 |
| 同上 | 下单前查 `payment_orders` 是否有该用户 `status='paid'` 的记录 → 决定首期价/标准价。**判定必须在服务端**（客户端传价格是不可接受的） |
| 会员有效期计算 | 加 `quarterly` → +3 个月；确认 `partner` 仍为永久 |
| `src/components/pricing/PricingClient.tsx` + `(public)/pricing/page.tsx` | 4 档 + 划线原价 + 「新用户首期」标签 + 「续费按原价 ¥X」明示 |
| `membership-benefits.ts` | `ComparisonRow` 加 `quarterly` 字段；`COMPARISON_ROWS` 每行补季度列；价格行改为 `¥29/¥79/¥199/¥499`（+ 原价提示） |
| `src/lib/membership-benefits.ts` 的 `pricing` 区块（298-300 行） | 同步 4 档 |

> ⚠️ **「续费按原价」必须在页面上写清**。这不是文案洁癖：决策 3 之所以合规，
> 前提是原价**真实成交过**（续费确实按 ¥39/¥109/¥299/¥699 收）。
> 如果页面只划原价、从不按原价收款，就构成《明码标价和禁止价格欺诈规定》
> 第十九条的**虚构原价**。所以「续费按原价」既是事实也是免责证据。

### 4.7 合规解绑（此前已拍板，纳入本轮）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/subscription.ts:128` | `if (!partner \|\| !partner.isPartner) return` → `if (!partner) return` |
| 2 | `src/app/api/partner/{commissions,dashboard,withdrawals,withdraw}/route.ts` | 4 处 `!partner?.isPartner` 门禁 → 「已注册即可」；提现两处保留「已绑定微信」 |
| 3 | 新增免费加入动作 | 写 `partnerAgreedAt`（合规留档证据，**不能缺**）；`partner-agreement` 页面勾选 → 免费加入 |
| 4 | `(public)/partner-agreement/page.tsx` | 4 处「付费=资格」表述改为免费加入（17-19、38、90、93 行） |
| 5 | `(public)/pricing/page.tsx:63`、`components/pricing/PricingFAQ.tsx:41` | 删掉佣金表述，只描述学习权益 |
| 6 | `membership-benefits.ts` | `PARTNER_BENEFITS` 拆为 `LIFETIME_BENEFITS` + `PROMOTER_BENEFITS`；`COMPARISON_ROWS` 移除佣金/提现行，改为一行「所有注册用户均可免费加入推广」 |
| 7 | `courses/sentences` 的 `trialAvailable` 等无需改 | — |

> **第 6 条要小心**：`PARTNER_BENEFITS` 被单测引用（`membership-benefits.test.ts`），
> 拆分后单测需要同步更新断言。这是**必须改**的，不是可选。

### 4.8 教材同步（新功能）

**新增**
- `src/lib/textbook-taxonomy.ts`：
  - 学段定义：`primary` 小学（grade_1–grade_6）/ `junior` 初中（grade_7–grade_9）/ `senior` 高中（`high_school`）
  - 版本清单（按实测出现频次排序）：人教版、外研版、译林版、鲁科版、北师大版、沪教版、冀教版、闽教版、教科版、粤人版、重庆版、陕旅版、北京版、牛津上海、其他版本
  - `OTHER_VERSION = "other"`（认不出的一律归此，**不猜**）
  - 学段 → 年级 的映射函数 + 单测
- `src/app/home/textbook/page.tsx` + `TextbookClient.tsx`：
  三级筛选（学段 → 年级 → 版本），复用课程卡片组件，**不复用 `CourseTabs`**（后者是单层分类，与三维筛选语义不同）
- `scripts/backfill-textbook-version.ts`：
  - 默认 **dry-run**：从 `courses.title` 解析版本，输出
    `content-textbook-version.json`（对照清单，含「解析结果 + 置信度 + 原始标题」）
  - `--apply` 才写库
  - 同时产出「疑似非教材同步」清单（如 `幼儿启蒙英语`、`英语启蒙`、`1年纪英语基础学习`）
- 导航新增「教材同步」入口

**修改**
- `src/app/api/courses/route.ts`：新增 `textbookVersion` 查询参数
- `src/lib/db/schema.ts`：`courses.textbookVersion`

**版本解析规则**（按优先级）
1. 优先匹配 `【…】` 括号内的版本名（67 门课有）
2. 其次全文关键词匹配（累计覆盖 114/194 = **59%**）
3. 都匹配不到 → `other`（80 门课）
4. **不做模糊猜测**：宁可归 `other`，也不要给用户错误的版本筛选结果

### 4.9 顺带的数据治理（版本解析脚本一并产出清单）

实测发现的脏数据（**只产出清单，不擅自改库**，等你看过再决定）：

| 问题 | 样例 | 数量 |
|---|---|---|
| 非教材同步内容混在 grade_N | `幼儿启蒙英语`、`英语启蒙`、`儿童英语启蒙·生活主题系列` | 十余门 |
| 标题错别字 | `1年纪英语基础学习`、`人教版】一年级上册`（缺左括号） | 少量 |
| grade_1 里塞了完整主题课 | `小学一年级：我的家人`/`颜色、数字与形状` 等 | 若干 |
| 高中未分年级 | `high_school` 单桶，无 高一/高二/高三 | 10 门 |

> 高中 10 门课里只有 4 门带版本（人教版必修一/二、外研社必修一、沪教版必修一）。
> **这就是「高中也能筛」的真实覆盖率**——功能可用，但内容薄。

---

## 5. 执行顺序（内部，不汇报）

按「纯函数层 → DDL/schema → 后端 → 前端 → 数据回填 → 测试」推进，
每一步之后立刻跑对应测试，保证失败可定位：

```
① 纯常量与纯函数：free-trial / trial-days / invite-rules / coins.ts / pricing.ts
   → pnpm test（这几个模块的单测最全）
② DDL: db/migrations/00027–00030 + schema.ts 同步
   → 本地 docker MySQL 跑一遍 SQL 验证语法
③ 金币后端：coins/earn、coins/redeem、check-in 改造
④ 会员赠钻 + AI 额度
⑤ 支付与定价后端：wechat-pay 首购价、quarterly、有效期计算
⑥ 合规解绑：subscription.ts:128、4 个路由、partnerAgreedAt、agreement 页面
⑦ membership-benefits 重构：4 档对比表、LIFETIME/PROMOTER 拆分
⑧ 前端：定价页 4 档、学习页金币、打卡页、AI 额度提示
⑨ 教材同步：taxonomy + 页面 + API + 回填脚本 dry-run
⑩ 测试收口：单测 / tsc / 改动文件 lint 对比 / e2e
```

## 6. 明确推迟的事（不在本轮）

| 事项 | 为什么推迟 |
|---|---|
| **打卡「手动领取 + 当天不领作废」** | 句乐部的机制，能制造第二次访问（学完还得回来点一下，不点就损失），是有效留存钩子。但需要「任务列表 + 领取状态 + 过期作废」一整套基础设施。本轮先做**自动发放**，基础设施成熟后再上 |
| `is_partner` / enum `partner` 重命名 | 本轮改动面已很大（4 处 DDL + 支付 + UI），叠加纯重命名会抬高出错概率且无用户价值。**改为加显式注释 + 单列任务** |
| 补签卡 / 改名卡实际可用 | 决策 1 只确认了「礼品开发中」；道具是 P2 |
| 精美礼品兑换落地 | 确认「对用户就说在开发中」 |
| 自动续费 | 已确认不做（且个体工商户接不了，见商务文档） |
| 大学教材同步 | 实测全库只有 2 门，做了是空列表 |
| 高中拆高一/高二/高三 | 只有 10 门课，拆完每档 3 门 |

## 7. 你必须做的一件事：执行生产库 DDL

**代码部署前必须先跑 DDL**，否则 schema 与库不一致会直接报错。

四个文件的执行顺序（**必须按序**，00028 依赖 00027 的 `users` 变更不影响，但 00028 自身依赖 `diamond_logs` 现状）：

```bash
# 1) 先备份（CLAUDE.md：生产库就是唯一的库，没有 staging）
#    db-backup/ 目录已存在，按既有习惯导一份

# 2) 按序执行
mysql "$DATABASE_URL" < db/migrations/00027_coins.sql
mysql "$DATABASE_URL" < db/migrations/00028_member_daily_grant.sql
mysql "$DATABASE_URL" < db/migrations/00029_quarterly_plan.sql
mysql "$DATABASE_URL" < db/migrations/00030_textbook_version.sql

# 3) 回填脚本（先 dry-run 看清单，确认后再 apply）
pnpm tsx scripts/backfill-textbook-version.ts            # 只产出 JSON
pnpm tsx scripts/backfill-textbook-version.ts --apply    # 写库
```

**幂等性**：`ADD COLUMN` / `CREATE TABLE` 重复执行会报错，属预期（跑一次即可）。
两处 `MODIFY COLUMN ... ENUM(...)` 是**向后兼容的扩展**（只加值、不删值），可安全重跑。

**回滚**：新增列/表可直接 `DROP`；ENUM 扩展无需回滚（多余的值不影响旧代码）。
`UPDATE` 类的改动本轮**没有**（不碰存量钻石余额——决策 2 已确认存量用户极少且无付费用户）。

## 8. 验证策略

| 手段 | 命令 | 说明 |
|---|---|---|
| 单测 | `pnpm test` | 30 文件 / 365 用例基线，必须全绿 |
| 类型 | `npx tsc --noEmit` | 无新增错误 |
| Lint | `git show HEAD:<file> \| npx eslint --stdin` 前后对比 | 按 CLAUDE.md，**只看增量**（HEAD 上本就有大量既有报错） |
| E2E | `pnpm e2e:db:up && pnpm test:e2e` | 需 docker；e2e 走 `drizzle-kit push` 从 schema 建库，所以 schema 必须已同步 |
| 浏览器 | `/tmp` 下 puppeteer 脚本 | 必须用 `http://localhost:3000`（**不能用 127.0.0.1**，见 CLAUDE.md） |

**确定性会失败、需要同步修改的既有测试**（这是改动的一部分，不是意外）：

| 测试 | 断言 | 改为 |
|---|---|---|
| `__tests__/trial.test.ts` | `TRIAL_DAYS === 5`、`jan30→feb4` | `3`、`jan30→feb2` |
| `__tests__/free-trial.test.ts` | 试学 3 句 | 5 句 |
| `__tests__/invite-rules.test.ts` | 7 天 / 30-20 / 5-3 | 5 天 / 7-7 / 3-3 |
| `__tests__/membership-benefits.test.ts` | `pro > free` for ai-chat（0 vs 2） | 3 vs 20；`PARTNER_BENEFITS` 拆分后的断言 |
| `tests/e2e/80-engagement.test.ts` | `/api/diamonds/earn` 发钻石 | `/api/coins/earn` 发金币 |
| `tests/e2e/20-payment.test.ts` | 三档定价 | 四档 + 首购价 |
| `tests/e2e/30-partner.test.ts` | 合伙人付费才可拿佣金 | 免费加入即可 |

## 9. 风险登记册

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 一次改 9 项，测试红时难定位 | **高** | 中 | §5 的顺序 + 每步跑测试；单个模块的改动尽量原子 |
| 生产库 DDL 未跑就部署 | 中 | **高** | §7 明确列为你的动作；代码里不做「列不存在则降级」的兼容层（那会掩盖问题） |
| e2e 需要 docker，环境不通 | 中 | 中 | 先跑单测 + tsc；e2e 若起不来会在计划中如实报告，不假装通过 |
| `membership-benefits` 重构打破价格页 | 中 | 中 | 该文件有专门的单测把关「权益不得漂移」，重构后必须全绿 |
| 教材同步筛选点进去内容太少 | **高** | 中 | 实测高中仅 10 门、部分年级 9 门；**这是内容问题不是代码问题**，在回填清单里如实标注 |
| 金币产出被刷 | 中 | 中 | 兑换有每月 3 天上限 + 服务端权威判定；礼品未开放 |

## 10. 相关文档

- [business-model.md](business-model.md) — 商业模式（§7 合规红线、§11 主动触达、§12 主体规划）
- [membership-growth-plan.md](membership-growth-plan.md) — 会员机制改造计划（P0-1…P2 原始出处）
- [distribution-compliance.md](distribution-compliance.md) — 分销合规边界（§4.7 的依据）
- [../CLAUDE.md](../CLAUDE.md) — 本地开发要点、迁移手工执行约束
