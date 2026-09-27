# 待办清单

> 活的文档：每完成一项就把状态改掉（`[ ]` → `[x]`）并补上提交号。
> 已完成的实现细节看 git log 与 `db/migrations/`；这里只记**还没做的事**与**需要人工介入的事**。

最后更新：2026-09-28

---

## 一、本次要进行（已与产品确认）

### [x] 0. 注册来源归因（回答「新增用户从哪来」）

起因：产品问「能分析出来新增的用户是从哪里来的吗，我还没对外推广过」——
当时**数据答不了**：建号时既没有埋点事件，也没有存 referrer / UA / IP。

存量分析结论（已用微信接口回填进库，详见 `scripts/backfill-signup-source.ts`）：

- 25 个账号 = **3 个测试账号**（本地连生产库调试留下的：微信开发用户 / 开发测试用户，以及老板本人 CHENCYS）
  + 1 个手机号 + 21 个微信
- 微信侧来源：**20 个「扫描二维码」**、1 个「公众号搜索」、3 个已取关。
  每个用户的 `subscribe_time` 与我们的 `created_at` 同刻 —— 账号是「扫码关注」那一刻
  由关注事件建出来的（二维码只在 `/login` 生成，所以**他们都到过 /login**）
- 真正练过的只有 4 个（含老板）：39 / 14 / 8 / 2 句；**19 个账号是「1 次会话 + 0 练习」**
- 真实收入 **¥0.02**（两笔测试支付）；那 ¥798 是两笔**未支付**的 ¥399 订单叠加的假象
- 邀请体系从未被外部使用（`referred_by` 全空）
- 唯一一次外部引荐是 `google.com`（09-27 01:47，匿名未注册）

已落地：

| 位置 | 内容 |
|---|---|
| `db/migrations/00023_user_signup_source.sql` | `users.signup_channel` + `signup_source`(JSON) + 索引（**已先于代码在生产执行**） |
| `src/lib/signup-source.ts` | 渠道与微信 `subscribe_scene` 词表、JSON 键白名单清洗、来源摘要 |
| `src/lib/first-touch.ts` | 首触归因：外部 referrer / UTM / 落地页，90 天 cookie，**只记第一次** |
| `src/lib/request-meta.ts` | IP / Referer / UA 提取的唯一实现（审计日志也改用这一份） |
| `src/lib/analytics-server.ts` | 服务端埋点写入（**永不抛错**） |
| `scripts/backfill-signup-source.ts` | 一次性回填（**必须在服务器上跑**：微信接口有 IP 白名单） |

四条建号路径全部落归因：公众号扫码链（`wechat/oa/event` 写微信侧 scene，
`auth/wechat/oa-check` 再用扫码者浏览器的请求头**合并**补齐 IP/UA/首触）、
`auth/wechat/callback`（区分微信内授权 / 开放平台扫码）、`auth/verify-code`、`auth/dev-login`。

两个容易再踩的坑：

1. **注册时的 Referer 不是来源**。注册永远发生在 `/login`，那一刻的 Referer 是我们自己
   （`https://typenow.cn/login`）或微信授权页。真正的来源只在落地页那一次请求里出现，
   所以必须靠 first-touch cookie 传递（`requestReferrer` 只作为排查信息单独存）。
2. **扫码链是两步**：关注事件先建号（只有微信侧字段），`oa-check` 才带着浏览器请求头到达。
   第二步必须**合并**而不是覆盖，否则会把第一步的 `subscribe_scene` 抹掉。

存量回填的口径：只填有证据的。23 行判得出渠道；**2 行（有 access_token 的）渠道留空，
只记 scene** —— 有 token 说明他们至少用过一次 OAuth 回调登录，但那可能是后来的登录，
建号究竟走哪条链路库里没有记录，**推测一个值比留空更有害**。

### [x] 0b. 历史数据修正 ✅ 已执行

- **回收 18 个过期体验会员的 `is_pro` 残留标记**：那 18 个「会员」全是注册时自动领的
  3 天体验会员（`pro_expires = created_at + 整 3 天`），过期后标记没回收，让后台的
  会员数虚高成 21。按 `checkAndExpirePro` 的同义执行（`is_pro=0` 且 `pro_expires=NULL`），
  已回收 18 行 → 现在 `is_pro=1` 只剩 **3 人**（三个合伙人账号，2125 年到期）

> ⚠️ 根因仍在：`checkAndExpirePro` 只被 `/api/auth/me`、`/api/subscription/status`、
> `/api/courses/sentences` 三处调用，所以**再也不回来的用户标记会一直留着**。
> 彻底修法是把报表口径改成 `is_pro=1 AND pro_expires > NOW()`（涉及仪表盘、
> 用户列表、订阅页几处计数），还没做 —— 见第三节。

### [x] 1. 首页头像体积 ✅ 已修

现状：`src/app/(public)/page.tsx` 的信任行用 4 个普通 `<img>` 显示头像，
但源文件是 **1000×1000 / 每张 80–112KB / 合计约 384KB**，实际显示尺寸只有 **20×20 CSS px**。

为什么值得修：像素量是需要的约 2500 倍。移动网络上这 384KB 会明显推迟首屏。

顺带：这 4 张图被 React 19 自动加了 `<link rel="preload" as="image">`，
Chrome 因此报 "preloaded but not used"（16 条同类警告的一部分）。
改成 `next/image` 且**不加 `priority`** 之后 preload 不再发送，警告一并消失。

做法：已换成 `next/image`，`width/height = 40`，**不加 `priority`**。

实测结果（`next start` + 抓真实响应）：

| | 原始 | 优化后 |
|---|---|---|
| 4 张合计 | 393,216 B（384KB） | **7,632 B**（每张 1.4–2.7KB WebP） |

同时首页 HTML 里的 `rel="preload" ... avatar` 数量从 4 变成 **0**，警告消失。
顺带把该文件原本的 4 条 `@next/next/no-img-element` lint 报错一并清零。

### [x] 2. `PUT /api/admin/users/[id]` 补校验 ✅ 已修

原状：这个接口可以改 `role`，但：

- `isPro` / `level` **完全不校验**（任意类型/任意值都能写进去）
- 没有"不能改自己"的保护（管理员可以把自己降权，直接失去后台）
- 没有"不能降级最后一个管理员"的保护
- 与 `proExpires` 的一致性没有约束：`isPro = 1` 但不设到期时间，语义不清

前端目前没有入口（用户详情页只读），所以只有手工构造请求才到得了 —— 正因为如此，
没有校验时它是一条**没人会注意到**的提权/自锁路径。

已加的守卫（`src/app/api/admin/users/[id]/route.ts`）：

1. `role` ∈ `{user, admin}`；`isPro` ∈ `{0, 1, true, false}`（归一到 0/1）；
   `level` 为 0~1000 的整数；`proExpires` 为可解析时间或 `null`（表示清空）
2. 三个字段一个都没给 → 400。原先会把全 `undefined` 的 patch 交给 drizzle，
   要么 500 要么静默什么都不做，两种都不是调用方想要的
3. **禁止自我降权**：`id === session.userId` 且要取消 admin → 400
4. **禁止降级最后一位管理员**：改的是 admin 且库里 admin 只剩 1 个 → 400
5. `isPro = 1` 时**写完之后**必须存在 `proExpires`（本次给了用本次的，没给沿用库里的）。
   因为 `checkAndExpirePro` 只在 `proExpires` 非空且已过期时才降级 ——
   `isPro=1 + proExpires=NULL` 等于永久会员且永不回收。想永久就显式传一个很远的日期

测试：`tests/e2e/89-user-admin-update.test.ts`（14 条，含 401 / 404 / 每类非法值 /
自我降权 / 最后一位管理员 / 一致性 / 脱敏字段）。

### [x] 3. 后台审计日志 ✅ 已做

现状：**完全没有**。谁给谁发了会员、谁删了内容、谁改了角色，一律查不到。

软删除缓解了"删错找不回"，但回答不了"是谁干的"。

已落地的部分：

| 位置 | 内容 |
|---|---|
| `db/migrations/00022_admin_audit_logs.sql` | 新表 `admin_audit_logs`（**已于 2026-09-28 在生产执行**，34 张表排序规则统一为 `utf8mb4_unicode_ci`） |
| `src/lib/admin-audit.ts` | 写入助手 `logAdminAction` + 脱敏/截断/差异计算（纯函数已被单测覆盖） |
| `src/lib/admin-audit-labels.ts` | 动作/对象词表（**无 db 依赖**，页面与接口共用一份） |
| `src/app/api/admin/audit-logs/route.ts` | 只读列表接口（按操作人/动作/对象/时间/关键词筛） |
| `src/app/admin/audit-logs/page.tsx` | 「操作审计」页面（已挂进后台菜单） |
| `tests/e2e/88-audit-logs.test.ts` | 18 条 e2e：留痕、筛选、拒绝不留痕、表不可用不影响业务 |

实际落日志的接口是 **14 个**（原文写 12 个，是漏数了）：

```
users/[id]                       改角色 / 会员 / 等级
courses  POST                    新建课程
courses/[id]  PUT/PATCH/DELETE   编辑 / 恢复 / 软删除（级联，含影响面）
lessons  POST                    新建课时
lessons/[id]  PUT/PATCH/DELETE   编辑 / 恢复 / 软删除
lessons/[id]/sentences/reorder   重排课时内句子顺序（记课名与句数）
sentences  POST                  新建句子
sentences/[id]  PUT/PATCH/DELETE 编辑 / 恢复 / 软删除
sentences/[id]/split             AI 拆分（记 chunk 数）
sentences/[id]/analyze           AI 解析（**仅未命中缓存时**记，命中不算付费动作）
materials/upload                 上传教材
materials/analyze                教材解析（记 LLM 调用次数）
materials/save                   批量导入句子
feedback/[id]  PATCH             处理反馈（退回待处理会清空 handled_by，只有审计留得住）
```

四条设计决定（改这块之前先读 `src/lib/admin-audit.ts` 的文件头）：

1. **操作者与对象都存文本快照**（`admin_label` / `target_label`），不是只存 id。
   日志要能在几个月后读懂，而那时用户可能已改名或删除。
2. **绝不抛错**：审计是旁路，写不进去只 `console.error`。表不可用时后台照常能用
   （e2e 里把表 rename 走验证过这条）。
3. **只记成功的写操作**：被守卫拒绝的请求不留痕，否则日志会被"尝试但没成功"灌满。
4. **写入侧脱敏**：`token`/`password`/`openid`/`secret` 一类键在落库前就被丢弃，
   库里不存在这些值（不是靠页面不显示）。

有意**不记**的东西：重排的完整句子顺序（一课最多 960 句、约 35KB，而拖动是自动
保存的高频操作；且数组上限 50 会静默截断，一份被截断的顺序比没有更危险）、
教材正文（可能是整本教材）、逐句内容。

上线校验（2026-09-28，均在 `typenow.cn` 上实测）：

- 迁移后 34/34 张表为 `utf8mb4_unicode_ci`，`admin_audit_logs` 的 4 条索引齐全
- 未带 cookie 访问 `/api/admin/audit-logs` → **401**（不是 500，说明路由与表都正常），
  `/admin/audit-logs` → 307（proxy 鉴权）
- 用一次**等值**写入（把某用户的 `level` 写回原值，不动数据）走通了真实链路：
  审计行落库、操作人快照为 `CHENCYS`、IP 记录正常；`detail.level` 为 NULL ——
  正是"只记真的变了的字段"该有的表现。探针行与会话事后已删除，数据未被改动

顺带修的：`db/schema-snapshot.sql` 原头部停留在「00009/00011–00013 已应用」，
但正文其实已经包含 `00016`/`00018`/`00020` 的列 —— 已重新生成并更正。
生成时多了一步：**去掉 ` AUTO_INCREMENT=<数字>`**（它是数据不是结构，每次导出都变，
留着会让真正的结构改动淹没在噪音里）。

---

## 二、需要**人工**介入（代码改不了）

### [ ] 重新"获取"一次旧课程

「获取课程」原先只存在浏览器 localStorage。服务端记录上线（`00020`）**之前**
获取过的课程，服务端没有数据，所以在「我的课程」里点进去仍会显示「获取课程」。

处理：随便进一次那门课的详情页点一下「获取课程」即可，之后永久记住（跨设备、清缓存都不丢）。

### [ ] 轮换阿里云 root 密码

服务器 root 密码在本次会话的聊天记录里出现过（明文）。
建议改密码并改用密钥登录，之后关闭 root 密码登录。

顺带评估：`ADMIN_PHONES` 那个号码目前挂在一个开发测试账号
（`微信开发用户`，同时持有 Pro + 合伙人身份）上，是否要挪到真实管理员账号。

---

## 三、已知但未排期

- **全库句子模糊搜索**：`chinese LIKE '%词%'` 在 46 万行 / 2.9GB 上是全表扫（实测 1.3–25 秒），
  所以接口目前**拒绝无课时范围的全库搜索**（400）。要真正支持需要
  `FULLTEXT ... WITH PARSER ngram`（需维护窗口建索引）。
- **词典英文释义没有中文**：悬浮卡里「词性 · 英文释义」的释义是词典原文英文。
  如需中文，可接现有 DeepSeek 通路做**按需翻译 + 缓存**（只在悬停时翻一次），
  需要评估成本与延迟。
- **后台列表的模糊搜索用不上索引**：`users.name` / `users.phone` 的 `LIKE '%x%'`
  是前导通配符。目前表小无感；量起来后要改前缀匹配或上全文索引。
- **无外键约束**：生产库 `fk_count = 0`。软删除让误删可恢复，但"孤儿行"仍可能产生
  （例如历史硬删留下的数据）。是否补外键需要单独评估（存量数据要先清理）。
- **metabase 常驻**：`~/metabase/`（本机 JVM + 两条 LaunchAgent 隧道）。
  结论是自建埋点更合适，它是留着做临时探索的；不用了可以卸载。
- **`is_pro` 与 `pro_expires` 可能不一致（统计口径问题）**：`checkAndExpirePro` 只在
  三个接口被调用时才回收过期会员，所以**再也不回来的用户会一直挂着 `is_pro=1`**
  （2026-09-28 实测 18 行，已手工回收）。要根治得把计数口径从 `is_pro=1` 改成
  `is_pro=1 AND pro_expires > NOW()`，涉及仪表盘会员数、用户列表 `pro=1` 钻取、
  订阅页统计等几处；或者加一条定时任务清理。**没做**。
- **webhook 交付偶发丢失**：2026-09-28 发现 `f099e02` 那次 push **没有触发部署**
  （deploy.log 里没有对应的「开始部署」，最后手工跑 `deploy.sh` 补上）；而紧接着的
  `dc046b7` 又正常触发了。同一时段 `git push` 本身也不稳定（连接 443 失败），
  所以更像是 GitHub 的**交付失败**而不是服务端漏处理。
  ⚠️ 服务端对此**毫无感知**：接口收到请求就回 200 再异步构建，交付丢了没有任何提示，
  只能靠人发现线上版本落后于 `origin/main`。要根治得加一条巡检
  （本地 `origin/main` 与线上 HEAD 不一致超过 N 分钟就告警），或改用
  「拉取式」部署（服务器定时 `git pull --ff-only`）。
  下次发生时先去 GitHub 的 Settings → Webhooks → Recent Deliveries 看那次交付的响应码。

  > 同一轮里已修掉的是一个**看起来像失败、其实成功了**的问题：webhook 的
  > `exec(DEPLOY_CMD, cb)` 没设 `maxBuffer`（Node 默认 1MB），而一次 Next 生产构建的
  > 输出轻易超过它 —— 超限时 Node 会杀掉子进程并回调错误，于是 deploy.log 里写着
  > 「部署完成」、webhook 日志里却是「部署失败」。现在显式给到 64MB，失败路径也会
  > 打印 stderr / exit code；实测同一次部署已报「部署成功（耗时 99s）」。
  > （提交 `dc046b7`。注意它需要 `pm2 restart webhook` 才生效 —— `deploy.sh` 只重启
  > `typenow`，不会重启 webhook 自己。）
- **webhook 端口在公网被扫**：`pm2 logs webhook` 的 error 里大量
  `拒绝：签名缺失或无效`。验签挡住了，但值得确认 9000 端口只对 GitHub 的出网
  地址段开放（或改用不可猜的路径）。

---

## 四、上线流程备忘（容易忘的两条）

1. **迁移是手工执行的**：仓库没有迁移执行器。新增 `db/migrations/*.sql` 后必须
   手工在生产库执行（见 `db/README.md`）。
2. **注意 DDL 与代码的先后顺序**：
   - 代码依赖新列/新表（如 `00016`/`00020`）→ **先执行 DDL，再部署代码**
   - 数据修正是"清掉旧解析结果"这类（如 `00019` 清单词缓存）→ **先部署代码，再执行 DDL**
     否则旧代码会把缓存重新灌成坏数据
