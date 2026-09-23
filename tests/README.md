# TypeNow 测试手册

三层测试，全部可本地复现：

| 层 | 命令 | 覆盖范围 | 依赖 |
|---|---|---|---|
| 单元 | `pnpm vitest run` | `src/**/*.test.ts`：纯函数与算法（判分、SM-2、练习统计、时区映射、微信支付加解密与请求头） | 无 |
| 功能/业务 e2e | `pnpm run test:e2e` | `tests/e2e/**/*.test.ts`：真实 Next dev 服务端 + MySQL 容器，跑 HTTP 接口 | Docker |
| 一起跑 | `pnpm run test:all` | 上面两套 | Docker |

`vitest.config.ts` 显式把单元测试限定在 `src/**`。**不要**用裸 `npx vitest run` 去跑全量目录：
默认 include 会把 `tests/e2e` 也扫进来，而它们需要专用配置与串行执行，
并行抢同一个测试库只会产出不可归因的 `ER_DUP_ENTRY`。

## e2e 环境

```bash
pnpm run e2e:db:up     # 起容器 typenow-test-mysql（127.0.0.1:3399，库 typenow_test）
pnpm run test:e2e
pnpm run e2e:db:down   # 用完销毁
```

`tests/e2e/global-setup.ts` 负责：建库建表 → 启动一个 `next dev`（端口 3311）→
等待就绪 → 全量跑完再关掉。`helpers/db.ts` 的 `assertTestDatabase()` 会拒绝连接
非 `typenow_test` 的库，防止误伤生产数据。

**测试期间服务端跑在 `NODE_ENV=development`**，这是刻意的：1 分钱沙箱价、
未签名回调、明文回调报文、`dev:<userId>` 会话旁路都只在 dev 分支存在。
代价是**生产专属行为（真实价格、签名拒绝、公钥验签）不在这套测试的覆盖范围内**，
需要单独对线上做只读核验。

## 用例分布

| 文件 | 主题 |
|---|---|
| `00-smoke.test.ts` | 基建自检：连的是测试库、夹具已写入、服务端确实是 development |
| `10-auth.test.ts` | 登录注册：验证码三层限流、一次性/过期码、建号试用、邀请码归属、会话与会员口径 |
| `20-payment.test.ts` | 支付：下单→回调→激活→续费→幂等/并发、金额校验、佣金口径、取消订阅 |
| `30-partner.test.ts` | 分销：看板口径、佣金脱敏、提现（含冷却解冻、回滚、行锁）、提现记录 |
| `40-learning.test.ts` | 学习：课程广场、课时列表、句子（会员门槛）、打字记录、进度 |
| `50-review.test.ts` | 复习本：队列、enqueue 去重、complete 参数校验与 SM-2 间隔 |
| `60-wordbook-notes.test.ts` | 单词本与笔记本：归一化、去重、上限、越权 |
| `70-oa-qrcode.test.ts` | 公众号：二维码 scene 携带邀请码、扫码登录闭环 |
| `80-engagement.test.ts` | 打卡、钻石发放、分享任务、首页/归档统计、词典与句子解析、埋点 |

## 已知的、刻意不改的现状

以下行为已被测试**钉住**（断言写成"当前是什么样"），它们是产品决策点，不是测试的疏漏：

1. **`POST /api/subscription/cancel` 会追回合伙人佣金，却不退款也不回收会员权益**，
   且目前没有前端调用方。任何登录用户都能借此抹掉合伙人的佣金并继续用 Pro。
   见 `20-payment.test.ts` 的 `[现状] 取消订阅会追回合伙人佣金，但不退会员权益`。
2. **没有有效订阅时取消订阅返回 500**（语义上更该是 404/400）。
3. `handleRefund` 忽略退款金额、没有 `refunded` 订单状态、没有发起退款的接口；
   `notify` 不校验 `mchid`/`appid`/时间戳新鲜度。
4. `sm2` 实现非标准（`easeFactor` 只增不减，UI 只给 2/4/5 三档）；
   `partner_risk_flags`、`users.referral_locked_until` 是死代码；
   验证码没有图形校验；限流是单进程内存态。

## 写新用例时的坑

- `practice_records` **没有** `duration_seconds` 列；练习时长只记在
  `diamond_logs.duration_seconds`。
- 句子知识缓存的表名是 `sentence_knowledge`（不是 `sentence_knowledge_cache`），
  且 `sentence_text` 是必填列。
- 词典缓存的列是 `phonetic` / `phonetic_uk` / `translations` / `pos`（都是 json），
  **没有** `phonetic_us` / `translation`。
- `analytics_events` 的列是 `event_type`，不是 `event`。
- `ApiClient.post(path, body)` 会把 body 包成 `{json: body}`；要传原始 JSON 用
  `.request("POST", path, { json: body })`。
- MySQL 的 `DATETIME` 只有秒精度，mysql2 写库时对毫秒**四舍五入**，
  所以"刚写入的时间"可能比 `Date.now()` 晚不到 1 秒。断言冷却/剩余秒数时
  留 1 秒余量，不要把上界写成精确值。
- 本机若残留一个 `next dev`（例如端口 3312），global-setup 会启动失败：
  先 `pgrep -fl "next dev"` 清掉。
