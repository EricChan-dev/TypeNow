-- 00015_sentences_indexes.sql
-- 句子列表页的两条索引（解决全表扫 + filesort）
--
-- 背景（生产库实测，2026-09-27）：
--   sentences 461,933 行 / 2.9GB（buffer pool 只有 128MB，所以数据页几乎全在磁盘上），
--   而这张表**只有 PRIMARY 与 idx_sentences_lesson_id 两条索引**。
--   后台句子列表的查询是 `ORDER BY sort_order, created_at LIMIT 20`（无筛选），
--   EXPLAIN：type=ALL、rows=336054、Using filesort。实测首屏 0.96s，
--   冷缓存状态下一次 5.3s；另有一条 `COUNT(*)` 每次翻页/搜索都要跑，135ms。
--
-- 为什么是 (lesson_id, sort_order) 而不是全局 (sort_order, created_at)：
--   sort_order **是课内顺序**，不是全局序号 —— 全表范围 0..960，而单个课时最多
--   960 句、平均 27.3 句。全局按它排序会把 16,891 个课时的"第 0 句"混在一起：
--   实测 `ORDER BY sort_order LIMIT 10` 取到的 10 行来自 **10 个不同课时**。
--   所以这个列表的正确语义是"先选课时，再按课内顺序看"，索引也必须
--   匹配这条访问路径；页面同时改成必须先选课时。
--
-- (created_at) 服务于"不选课时时看最近添加的句子"——这是唯一在全局意义上
-- 有意义的顺序，也让默认视图不再依赖 filesort。
--
-- 为什么现在加：这两条都是纯加索引、不改数据；索引体积合计约 80MB
-- （磁盘剩余 24G）。MySQL 8 对加二级索引支持 Online DDL，
-- 用 ALGORITHM=INPLACE, LOCK=NONE 不会阻塞线上读写。
--
-- 注意：**不涉及全文检索**。`WHERE chinese LIKE '%词%'` 在这种规模上
-- B-tree 索引救不了（前导通配符），全库模糊搜索需要 FULLTEXT + ngram 分词，
-- 那是另一次需要维护窗口的改动。本轮的做法是把搜索限定在课时范围内
-- （平均 27 行，毫秒级），并在接口层拒绝无范围的全库搜索。
--
-- 是否需要手动执行：需要。仓库没有迁移执行器（见 db/README.md）。

ALTER TABLE sentences
  ADD INDEX idx_sentences_lesson_sort (lesson_id, sort_order),
  ADD INDEX idx_sentences_created_at (created_at),
  ALGORITHM=INPLACE, LOCK=NONE;
