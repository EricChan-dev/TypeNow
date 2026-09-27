-- 00016_soft_delete.sql
-- 课程 / 课时 / 句子改为软删除
--
-- 背景：这三个表此前是**硬删除**，而库里**一个外键都没有**（实测
-- information_schema 的 fk_count = 0）：
--   DELETE FROM courses WHERE id = ?
-- 删掉一门课程，它名下最多 16,891 条课时和全部句子会变成孤儿行 ——
-- 站点上看不到了，但永久留在库里，继续计入「句子总数 461,933」、继续被扫。
-- 不可逆，而且后台的删除按钮就在列表页上、没有二次确认、没有审计记录。
--
-- 为什么选软删除而不是级联硬删：sentences 有 46 万行 / 2.9GB 且在线上使用中，
-- 硬删的爆炸半径太大（误删一门课可能带走一个月的导入成果）。软删除让误删可恢复。
--
-- ── 两列的分工（deleted_at 与 deleted_batch）─────────────────────────────────
--
--   deleted_at    —— 什么时候删的（展示用）
--   deleted_batch —— 哪一次删除操作（**恢复时的唯一依据**）
--
-- 为什么批次必须单独一列，而不能用 deleted_at 的时间戳当批次标识：
--   级联删除时课程/课时/句子要写同一个值，恢复时按它精确还原这一批 ——
--   既不能漏（子内容还藏着），也不能多（把之前单独删掉的句子一起复活）。
--   我最初就是用 deleted_at(3) 当这个标识的，**上线前被测试证伪**：
--   本仓库 drizzle 的 datetime 映射是
--     `new Date(t + 8h).toISOString().slice(0, 19)`   ← 只取到「秒」
--   （见 src/lib/db/index.ts 的 toDbDateTime），毫秒被无条件抹掉。
--   于是同一秒内发生的两次删除会得到完全相同的值，恢复时互相串台 ——
--   测试里"先单独删一句、20ms 后删整门课、再恢复课程"就直接把那一句误复活了。
--   用显式 UUID 批次就完全不依赖时间精度，这个问题从根上消失。
--
-- 为什么**不加** deleted_at / deleted_batch 的索引：
--   `IS NULL` 对绝大多数行都成立（删除是极少数），选择性接近 0，优化器不会用。
--   真正的主查询已经是 `WHERE lesson_id = ? ORDER BY sort_order`（走 00015 建的
--   idx_sentences_lesson_sort，单课平均 27 行、最多 960 行），这两个条件作为
--   残差在这几十行上过一遍是免费的。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 都是加可空列、不改数据，Online DDL，可在业务时段安全执行。

ALTER TABLE courses
  ADD COLUMN deleted_at DATETIME(3) DEFAULT NULL,
  ADD COLUMN deleted_batch CHAR(36) DEFAULT NULL;

ALTER TABLE lessons
  ADD COLUMN deleted_at DATETIME(3) DEFAULT NULL,
  ADD COLUMN deleted_batch CHAR(36) DEFAULT NULL;

ALTER TABLE sentences
  ADD COLUMN deleted_at DATETIME(3) DEFAULT NULL,
  ADD COLUMN deleted_batch CHAR(36) DEFAULT NULL;
