# TypeNow · 码上英语 PRD V3

> 文档日期：2026-05-28（最后更新：2026-05-28，P0 全部完成）
> 基于对当前代码库的完整审计生成，反映 v2 已实现内容及 v3 规划。

---

## 一、产品现状总览

### 1.1 已完成功能（Production Ready）

| 模块 | 功能 | 说明 |
|------|------|------|
| **认证** | 手机号+短信验证码登录 | Aliyun SMS，60s 防重发 |
| **认证** | 微信 OAuth 登录 | WeChat Open Platform，CSRF 保护 |
| **认证** | 新用户 3 天免费试用 | 注册时写入 isPro=1，proExpires=+3d |
| **认证** | SMS 速率限制 | IP 1分钟≤3次；手机 1小时≤5次，24小时≤10次 |
| **会员** | 月度/年度/合伙人套餐 | WeChat Pay Native，webhook 回调激活 |
| **会员** | 会员到期自动降级 | `checkAndExpirePro()` 懒加载触发 |
| **会员** | 会员等级标识 | 试用会员/月度会员/年度会员/永久会员/普通用户 |
| **学习** | 课程商城 | 分类筛选、搜索，接入真实 DB |
| **学习** | 课程详情 + 章节列表 | 接入真实 DB |
| **学习** | 打字练习（word-mode）| 逐词练习、chunk 模式、自动播音 |
| **学习** | 进入章节前加载屏 | animejs 进度条动画 |
| **学习** | 章节完成弹窗 | 分数/用时/失误统计，再来一次/返回课程 |
| **学习** | 学习后自动加入我的课程 | localStorage + 后端 `user_course_progress` 双写，跨设备同步 |
| **学习** | 相对时间戳 | "5分钟前学过"，"2天前学过" |
| **学习** | 会员门控 | learn 页需要 isPro，否则跳 /pricing |
| **学习** | 音标 + 词性分析 | CompletedSentence 展示 phonetic + POS badge |
| **学习** | 词性分组 | 完成句子后按词性归类展示 |
| **学习** | 学习进度后端持久化 | `user_course_progress` 表 + `POST /api/user/progress` |
| **复习** | 句子入队（SM-2）| 完成句子后自动 `POST /api/review/enqueue` |
| **复习** | 复习队列 API | `GET /api/review/queue`，限 20 条，JOIN sentences |
| **复习** | 复习完成 API | `POST /api/review/complete`，SM-2 算法更新间隔 |
| **复习** | 复习模式页面 `/home/review` | Word-mode 打字 + 三档评分按钮（再次巩固/记住了/很熟练）|
| **复习** | 主页复习提醒 | `ReviewReminder` 显示真实待复习数量，跳转 `/home/review` |
| **AI** | 句子成分分析 | DeepSeek，带缓存（sentence_knowledge 表） |
| **AI** | 课程 AI 一键生成 | 粘贴/上传文本，AI 拆章节+句子 |
| **AI** | 句子 AI 拆分（chunks）| 管理端，AI 拆 2~5 个渐进短语 |
| **合伙人** | 合伙人加入页 | ¥399 一次性，跳转微信支付 |
| **合伙人** | 合伙人看板 | 收益/可提现/冷静期 + 佣金明细 |
| **合伙人** | 邀请链接 + 二维码 | 一键复制，Canvas 海报生成 |
| **合伙人** | 推广话术库 | 3 个场景文案 |
| **合伙人** | 提现（微信商家转账）| `POST /api/partner/withdraw` |
| **合伙人** | 佣金触发 | 首次 50% / 续费 30%，15 天冷静期 |
| **合伙人** | 侧边栏分流 | 已是合伙人显示"推广中心"，否则"合伙人中心" |
| **管理端** | 课程/章节/句子 CRUD | refine.dev + Ant Design |
| **管理端** | 图片上传（base64）| MEDIUMTEXT 存储 |
| **管理端** | 启用/禁用课程 | isPublished Switch |
| **定价页** | 套餐对比 + 支付 | 月付/年付/合伙人，微信 Native |
| **TTS** | 有道 TTS，带缓存 | SHA-256 key，`tts_cache` 表 |
| **分析** | 自定义事件埋点 | `analytics_events` 表 |
| **主页** | 数据看板 `/home` | 签到日历、连胜数、统计卡、本周趋势、继续学习 |
| **学习档案** | 成长分析 `/home/archive` | 投入统计、高光时刻、SVG 折线趋势图、年度热力图 |
| **设置** | 用户设置 `/home/settings` | 头像/昵称、手机号、会员信息、订阅记录 |

---

### 1.2 部分实现（Partially Built）

| 模块 | 现状 | 缺失 |
|------|------|------|
| **合伙人看板** | 数据和提现已通 | 退款回扣逻辑、风控 flags 管理端展示 |
| **AI 强化练习** | `strengthen_sessions` + `writing_entries` 表已存在 | 无任何前端页面 |

---

### 1.3 功能存根（Stub / Empty）

| 页面 | 现状 |
|------|------|
| `/home/leaderboard` | "功能开发中…" |

---

### 1.4 已知技术债

| 类别 | 问题 | 状态 |
|------|------|------|
| **安全** | 管理端 `/admin` 仅靠 cookie 鉴权，无 CSRF 保护 | 待处理 |
| **稳定性** | 无 React Error Boundary，AI 调用失败会白屏 | 待处理 |
| **测试** | 未配置任何测试框架 | 待处理 |
| **监控** | Sentry DSN 配置后才生效，本地无监控 | 待处理 |
| **合伙人** | 退款佣金回扣逻辑已设计但未实现 | P1 |
| **合伙人** | 风控 flags 仅写库，无管理端查看入口 | P1 |
| **合伙人** | 提现结算周期 UI 显示"随时提现"，实际设计为每月 15 日 | P1 |

---

## 二、v3 目标

**核心命题**：从"打字练习工具"升级为"AI 全程陪练的英语学习闭环"。

**v3 三大支柱**：
1. **留存** — 复习提醒 + 连续打卡 + 用户主页数据化
2. **增长** — 合伙人系统完善 + 社交分享 + 排行榜
3. **深度** — AI 强化练习（问答/写作/对话）

---

## 三、v3 功能规划

### P0 — 必做（v3 发布前）✅ 全部完成

---

#### 3.1 用户主页重设计 `/home` ✅

**实现**：`HomeClient.tsx` 完整重写，两栏布局（签到日历 + 热力图），统计看板，本周趋势柱状图，月度签到日历（带当月高亮），继续学习卡，复习提醒卡。

**API**：`GET /api/home/stats` 返回 `{ totalSentences, studyDays, streak, pendingReviews, weekTrend, checkInDatesThisMonth, ... }`

---

#### 3.2 复习队列完整闭环 ✅

**实现**：
- `review_queue` 表新增 `interval_days`（INT）、`ease_factor`（DECIMAL 4,2）字段
- `POST /api/review/enqueue` — 幂等入队，done 状态可重置
- `GET /api/review/queue` — 返回 status='pending' AND nextReviewAt≤now 的句子，JOIN sentences，最多 20 条
- `POST /api/review/complete` — SM-2 算法：grade 0-2 重置间隔；grade 3 ×1.2；grade 4 ×EF；grade 5 ×EF×1.15，EF+=0.1（上限3.0）；intervalDays≥14 且 grade≥4 则 status='done'
- `ReviewClient.tsx` — 完整 word-mode 打字 UI，完成后显示三档评分按钮
- `LearnClient.tsx` — 完成每句后 fire-and-forget 调用 enqueue
- `ReviewReminder.tsx` — 读取真实待复习数量，链接跳转 `/home/review`

---

#### 3.3 设置页 `/home/settings` ✅

**实现**：`SettingsClient.tsx`（445行）+ `PUT /api/user/profile` + `GET /api/user/subscriptions`

---

#### 3.4 短信速率限制 ✅

**实现**：`verification_codes` 表新增 `ip` 列（VARCHAR 50），发送时记录。限流：同 IP 1分钟≤3次；同手机 1小时≤5次；同手机 24小时≤10次。超限返回 429。

---

#### 3.5 学习记录后端持久化 ✅

**实现**：
- 新增 `user_course_progress` 表（userId, courseId, lastStudiedAt, sentenceCount，uniqueIndex on userId+courseId）
- `POST /api/user/progress` — upsert，sentenceCount 取 GREATEST(现有, 新值)
- `GET /api/user/progress` — 返回用户全部课程进度
- `LearnClient.tsx` — 进入章节时和完成句子时 fire-and-forget 更新进度
- `MyCoursesClient.tsx` — localStorage 与 DB 合并，取 lastStudiedAt 最新者

---

### P1 — 重要（v3 期间迭代）

---

#### 3.6 学习档案 `/home/archive` ✅（已随 P0 同批实现）

**实现**：`ArchiveClient.tsx` — 学习投入统计（4卡）、高光时刻（4卡）、SVG 折线趋势图（紫色渐变填充）、年度热力图（YearlyHeatmap 提取为独立组件）、期间筛选（本周/本月/全部）。

**API**：`GET /api/archive/stats?period=week|month|all`

---

#### 3.7 排行榜 `/home/leaderboard`

**当前**：存根页面。

**v3 目标**：激发竞争动力，提升留存。

**UI 设计**：
- Tab 切换：本周 / 本月 / 总榜
- 排名列表：头像 + 昵称（脱敏）+ 练习句数 + 分数
- 当前用户排名高亮（即使不在前 20 名，底部固定显示自己排名）

**API**：
- `GET /api/leaderboard?period=week` — 返回 TOP 20 + 当前用户排名
- 计算方式：`SUM(score)` FROM `practice_records` WHERE 时间范围内

---

#### 3.8 合伙人系统完善

**当前缺失**：

**3.8.1 退款佣金回扣**
- 扩展退款 webhook 处理（`/api/payment/notify`）
- 退款成功时查 `partner_commissions WHERE order_id=?`
- `cooling` 状态：直接 `clawed_back`
- `available` 状态：`clawed_back` + 写 `partner_risk_flags`

**3.8.2 管理端风控看板**
- `/admin/partner/risk` — 风控 flags 列表（合伙人 + 触发原因 + 时间）
- 操作：标记已处理 / 封号

**3.8.3 提现结算周期 UI 修复**
- 当前 PartnerJoin.tsx 显示"随时极速提现"与设计文档不符
- 合伙人 dashboard 需添加提现开放状态：每月 15 日前后 3 天开放，其余时间灰色提示

---

### P2 — 未来迭代

---

#### 3.9 AI 强化练习

**现状**：`strengthen_sessions` + `writing_entries` 表已存在，无任何前端页面。

**规划**：
- `/home/strengthen` — 基于已学句子生成填空/问答测验
- `/home/write` — AI 批改写作练习
- API：`POST /api/strengthen/quiz`、`POST /api/strengthen/submit`、`POST /api/write/submit`

---

#### 3.10 微信分享优化

- 自定义 Open Graph meta（分享时展示课程封面 + 标题）
- 分享特定句子：生成"金句卡片"图片（Canvas）

#### 3.11 离线/PWA 支持

- Service Worker 缓存已学句子的 TTS 音频
- 支持无网络下复习已缓存内容

#### 3.12 用户级内容

- 允许用户导入自定义句子（上传文本 → AI 生成单词注释）
- 用户私有课程，不公开

#### 3.13 批量导入句子音频预生成

- 新建章节时后台批量调 Youdao TTS，提前缓存
- 降低首次学习延迟

---

## 四、技术架构决策

### 4.1 数据层

| 组件 | 技术 | 说明 |
|------|------|------|
| 主数据库 | MySQL（Drizzle ORM）| 替代原 Supabase Postgres |
| 会话管理 | 自建 sessions 表 + httpOnly cookie | 替代 Supabase JWT |
| 文件存储 | base64 MEDIUMTEXT（临时）| 中期迁移到 OSS |
| TTS 缓存 | tts_cache 表（base64 audio）| 避免重复调 Youdao |
| AI 知识缓存 | sentence_knowledge 表 | 同一句子不重复调 LLM |

### 4.2 认证架构

```
手机号登录 → send-code → verify-code → createSession()
微信登录   → /api/auth/wechat → OAuth → upsertWeChatUser() → createSession()
管理端     → /admin/login → cookie（独立，不共享主 session）
```

### 4.3 会员体系

```
注册 → isPro=1, proExpires=+3d（试用）
      ↓
    到期 → checkAndExpirePro() → isPro=0（普通用户）
      ↓
    购买月付/年付 → activateSubscription() → isPro=1 + subscriptions 记录
      ↓
    购买合伙人 → grantPartnerAccess() → isPartner=1 + inviteCode + subscriptions(永久)
```

### 4.4 前端架构

- Next.js App Router，Server Components 优先
- 客户端状态：React useState（无全局 Store）
- 样式：Tailwind v4 + CSS 变量 semantic token
- 动画：animejs v4（学习 UI）
- 拖拽：@dnd-kit（管理端排序）
- Toast：sonner

---

## 五、DB 变更清单（v3）

### 已完成

```sql
-- 学习进度（跨设备同步）✅
CREATE TABLE user_course_progress (
  id              VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id         VARCHAR(36) NOT NULL,
  course_id       VARCHAR(36) NOT NULL,
  last_studied_at DATETIME    NOT NULL,
  sentence_count  INT         NOT NULL DEFAULT 0,
  UNIQUE KEY uk_user_course (user_id, course_id),
  INDEX idx_ucp_user (user_id)
);

-- SMS 速率限制 IP 记录 ✅
ALTER TABLE verification_codes ADD COLUMN ip VARCHAR(50) NOT NULL DEFAULT '';

-- SM-2 复习算法字段 ✅
ALTER TABLE review_queue
  ADD COLUMN interval_days INT NOT NULL DEFAULT 1,
  ADD COLUMN ease_factor DECIMAL(4,2) NOT NULL DEFAULT '2.50';
-- review_queue 同时改为 uniqueIndex on (user_id, sentence_id)
```

### 待实现

```sql
-- 排行榜（无需新表，从 practice_records 聚合）
-- AI 强化练习（表已存在：strengthen_sessions, writing_entries）
```

---

## 六、API 变更清单（v3）

### 已完成

| 方法 | 路径 | 功能 | 状态 |
|------|------|------|------|
| GET | `/api/home/stats` | 主页统计数据 | ✅ |
| POST | `/api/review/enqueue` | 句子加入复习队列（幂等）| ✅ |
| GET | `/api/review/queue` | 获取待复习句子（max 20）| ✅ |
| POST | `/api/review/complete` | 标记复习完成，SM-2 更新 | ✅ |
| PUT | `/api/user/profile` | 更新用户昵称/头像 | ✅ |
| GET | `/api/user/subscriptions` | 订阅历史 | ✅ |
| POST | `/api/user/progress` | 更新学习进度（跨设备）| ✅ |
| GET | `/api/user/progress` | 获取学习进度 | ✅ |
| GET | `/api/archive/stats` | 学习档案统计 | ✅ |
| POST | `/api/auth/send-sms` | 添加速率限制（IP + 手机号）| ✅ |

### 待实现

| 方法 | 路径 | 功能 | 优先级 |
|------|------|------|--------|
| GET | `/api/leaderboard` | 排行榜 TOP20 + 当前用户排名 | P1 |
| POST | `/api/payment/notify` | 扩展退款回调处理佣金回扣 | P1 |
| POST | `/api/strengthen/quiz` | 生成强化测验 | P2 |
| POST | `/api/strengthen/submit` | 提交测验答案 | P2 |
| POST | `/api/write/submit` | 提交写作批改 | P2 |
| GET | `/api/write/history` | 写作历史 | P2 |

---

## 七、页面变更清单（v3）

### 已完成

| 路由 | 内容 | 状态 |
|------|------|------|
| `/home` | 从问候语改为完整数据看板 | ✅ |
| `/home/archive` | 从存根改为成长分析页 | ✅ |
| `/home/review` | 复习模式（word-mode + SM-2 评分）| ✅ |
| `/home/settings` | 用户设置页 | ✅ |

### 待实现

| 路由 | 内容 | 优先级 |
|------|------|--------|
| `/home/leaderboard` | 从存根改为真实排行榜 | P1 |
| `/home/partner/dashboard` | 添加提现结算期状态 + 退款回扣显示 | P1 |
| `/home/strengthen` | AI 强化测验 | P2 |
| `/home/write` | AI 写作练习 | P2 |

---

## 八、成功指标

| 指标 | 当前 | v3 目标 |
|------|------|--------|
| 7 日留存率 | 未知（无埋点分析）| > 35% |
| 次日复访率 | 未知 | > 50% |
| 平均每日练习句数 | 未知 | > 8 句 |
| 合伙人转化率（试用→付费）| 未知 | > 15% |
| 试用期付费转化 | 未知 | > 8% |
| 月续费率 | 未知 | > 65% |

> 首要任务：接入 analytics_events 埋点到关键节点（练习完成、章节完成、付费、合伙人注册），建立基准数据。

---

## 九、实施进度

### 阶段一 ✅ 完成（P0 核心体验）
1. ✅ 主页数据看板（`/api/home/stats` + HomeClient 重设计）
2. ✅ 学习档案 `/home/archive`（成长分析 + 折线图 + 热力图）
3. ✅ 设置页 `/home/settings`
4. ✅ SMS 速率限制（IP + 手机号多维度）
5. ✅ 学习进度后端持久化（`user_course_progress` 表 + API）
6. ✅ 复习队列完整 UI（SM-2 + 入队 + 复习模式 + 三档评分）

### 阶段二（P1 深度功能）
7. 排行榜页（`/api/leaderboard` + UI）
8. 合伙人退款回扣 + 管理端风控看板
9. 提现结算期 UI 修复

### 阶段三（P2 深度功能）
10. AI 强化测验 + AI 写作练习
11. 微信分享优化
12. PWA/离线支持

---

*PRD_V3 — 码上英语产品团队 · 2026-05-28*
