# 数据库目录说明

> 本目录前身是 `supabase/`，是 Supabase 时期的命名遗留。2026-09-26 已重命名为 `db/`。

## 权威顺序

| 位置 | 作用 |
|---|---|
| `src/lib/db/schema.ts` | **日常改结构的地方**（Drizzle 定义）。e2e 测试库由 `drizzle-kit push` 从这里生成 |
| `schema-snapshot.sql` | **线上实际结构的只读快照**（仅结构无数据），用于比对 |
| `migrations/*.sql` | 已对线上执行过的增量 DDL |

**改结构时的约束**：`migrations/` 与 `schema.ts` 必须同步修改。e2e 走
`drizzle-kit push`（不读 `migrations/`），生产走手工执行 `migrations/`，
两条路径只有靠人工保持一致。

**新增表必须显式写排序规则**：`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`。

不写的后果（2026-09-27 实际踩到，排查了很久）：MySQL 8 的服务器默认是
`utf8mb4_0900_ai_ci`，于是新表与既有表（含 `users`）**排序规则不一致**。一旦有查询
把两张表 JOIN 起来比较字符串列，MySQL 直接报
`ERROR 1267 Illegal mix of collations ... for operation '='`，表现为
**某个页面莫名 500**，而服务端日志里往往看不到有用信息（错在驱动层就抛了）。

当时生产库里就躺着 4 张这种表（`post_likes` / `practice_sessions` /
`task_logs` / `user_feedback`），直到新写的后台反馈接口做了
`user_feedback LEFT JOIN users` 才炸出来（见 `00021_unify_collation.sql`）。

⚠️ **e2e 抓不到这类问题**：它的库是 `drizzle-kit push` 一次性生成的，所有表排序规则
天然一致 —— 但一致在**服务器默认值**上，与生产用的 `utf8mb4_unicode_ci` 并不是同一个
（见下面「`drizzle-kit push` 不会应用表级 COLLATE」）。所以只能靠核对线上库：

```sql
SELECT table_collation, COUNT(*) AS tables
FROM information_schema.tables
WHERE table_schema='typenow' AND table_type='BASE TABLE'
GROUP BY table_collation;
-- 只应有一行；出现第二行就说明漂移了
```

## 关于被删除的 10 个文件

2026-09-26 删除了 `init-all.sql` 与 `migrations/00001`–`00008`、`00010`，
共 10 个文件。原因：**它们是 PostgreSQL DDL，不是 MySQL**。

判定依据（这些文件里没有任何 MySQL 特征，却大量出现 PG 专有语法）：

- `auth.users`、`public.` schema、`CREATE POLICY` / `ROW LEVEL SECURITY`
- `UUID`、`gen_random_uuid()`、`JSONB`

把它们当 MySQL 迁移执行会直接报错。而当时的文档（`CLAUDE.md`、`README.md`、
`docs/architecture.md`）却写着「`db/migrations/*.sql` 里面是 MySQL DDL，
新增迁移后需在生产库手动执行」——照着做会在 10 个文件里踩空。

删除后 SQL 级别的结构记录由 `schema-snapshot.sql` 接管。
**如需查阅原文**，git 历史里仍在：

```bash
git show <旧提交>:supabase/migrations/00001_initial_schema.sql
```

## 现存迁移（均为 MySQL）

| 文件 | 内容 | 执行顺序要求 |
|---|---|---|
| `00009_tasks_feed_feedback.sql` | `task_logs` / `posts` / `user_feedback` 等 | 先 DDL |
| `00011_practice_sessions.sql` | 练习会话恢复槽位 | 先 DDL |
| `00012_trial_claim.sql` | `users.trial_claimed_at`（体验会员一次性领取）+ 存量回填 | 先 DDL |
| `00013_invite_purchase.sql` | `task_logs.task_type` 追加 `invite_purchase`、幂等键改为 `(task_type, ref_id)` | 先 DDL |
| `00014_stats_time_indexes.sql` | 后台时间范围统计所需的索引 | 顺序无关 |
| `00015_sentences_indexes.sql` | 句子列表页的两条索引（解决全表扫 + filesort） | 顺序无关（大表建索引，见文件头） |
| `00016_soft_delete.sql` | 课程 / 课时 / 句子改为软删除 | **先 DDL**（代码依赖新列） |
| `00017_missing_indexes.sql` | 补两条后台筛选缺失的索引 | 顺序无关 |
| `00018_feedback_handling.sql` | 用户反馈的「处理流转」字段 | 先 DDL |
| `00019_purge_word_dict_cache.sql` | 清空单词释义缓存（一次性数据修复） | ⚠️ **先部署代码**，否则旧代码会把缓存重新灌成坏数据 |
| `00020_user_acquired_courses.sql` | 「获取课程」改为服务端记录 | **先 DDL**（代码依赖新表） |
| `00021_unify_collation.sql` | 统一 4 张表的排序规则（修复后台反馈页 500） | 顺序无关 |
| `00022_admin_audit_logs.sql` | 后台操作审计日志 | **先 DDL**（代码依赖新表） |
| `00023_user_signup_source.sql` | 注册来源归因（`users.signup_channel` + `signup_source`） | **先 DDL**（代码依赖新列） |
| `00024_analytics_visitor_id.sql` | 匿名访客长期身份（`analytics_events.visitor_id` + 索引） | **先 DDL**（代码读写新列；执行后需重新生成结构快照） |
| `00027`–`00030` | 金币体系 / 会员每日赠钻 / 季度档 / 教材版本（见 docs/implementation-plan-2026-09.md §7） | **先 DDL**（代码依赖新列与新枚举值） |
| `00031_sentence_search.sql` | `sentences.search_text` 生成列 + FULLTEXT ngram 索引（后台全库句子搜索） | **先 DDL**。⚠️ 这是**表重建**（约 16 分钟，重建期间写入被阻塞）；`drizzle-kit push` **建不出这个索引**，e2e 侧由 `tests/e2e/helpers/db.ts` 的 `ensureSentenceSearchIndex()` 补建 |
| `00032_lifecycle_notifications.sql` | `notifications` 表 + `users.notify_opt_out_at`（退订位）+ `users.last_expiry_at`（上次到期时刻，主动触达体系用） | **先 DDL**（代码依赖新表与新列） |
| `00033_pronunciation_scores.sql` | `pronunciation_scores` 表（跟读评分，一句话一行，重录覆盖） | **先 DDL**（代码依赖新表；`id` 的库级默认值只在迁移里，见文件头） |

编号不连续是正常的（中间的是被删掉的 PG 文件）。**不要为了连续而重排编号**：
文档与提交信息里都按编号引用过这些文件。

「执行顺序要求」一列不是形式主义：**代码依赖新列/新表时必须先执行 DDL**
（否则部署后相关接口 500），而**数据修正类**（`00019`）必须反过来 ——
先部署代码再清数据，否则还在跑旧代码的进程会把刚清掉的坏数据重新写回去。
判断方法只有一句话：**这次变更里，新代码会不会读/写一个当前库里还不存在的结构？**

### 迁移不会自动执行，也不会有提示

仓库没有迁移执行器（无 npm 脚本 / 无 CI / `deploy.sh` 不含 SQL 步骤），
所以**加了迁移而不去线上执行，代码会带着一个不存在的表/列上生产**。
唯一的指望是写迁移的人在同一个工作流里把它执行掉 ——
`docs/TODO.md` 的上线备忘里也记着这条。

### `drizzle-kit push` 不会应用表级 COLLATE

2026-09-27 实测：新建表的迁移里写了
`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`，
但 e2e 测试库（由 `drizzle-kit push` 从 `schema.ts` 生成）建出来的仍是
服务器默认的 `utf8mb4_0900_ai_ci`。也就是说**测试库与生产库的排序规则
永远不一致，而且是静默的** —— e2e 里所有 JOIN 都正常，生产上却可能
抛 `Illegal mix of collations`（00021 那次事故）。

结论：判断排序规则只能查线上库（下面的 SQL），不要用测试库的结果推断生产。

## 重新生成结构快照

只读操作，在服务器上以 `.env.local` 的 `DATABASE_URL` 执行：

```bash
mysqldump --no-data --skip-comments --single-transaction --routines --triggers typenow > schema-snapshot.sql
```

## 迁移是手工执行的

仓库没有任何迁移执行器：`package.json` 无 migrate 脚本、`.github/` 下无 workflows、
`deploy.sh` 不含 SQL 步骤。新增迁移后需在生产库手动执行，执行前先备份。
