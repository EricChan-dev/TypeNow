-- 00020_user_acquired_courses.sql
-- 「获取课程」改为服务端记录
--
-- 背景（用户实际遇到的问题）：
--   我的课程列表里点进一门课，详情页却显示「获取课程」。
--   根因是"是否已获取"**只存在浏览器 localStorage**（typenow_acquired_courses），
--   而"我的课程"列表是按 `已获取 ∪ 已练习过` 算出来的（已练习来自服务端 progress）。
--   于是清一次浏览器数据（用户为了看到新版刚清过缓存）就把已获取记录清空了：
--   课程因为"练习过"仍然留在列表里，但点进去读到的是空的 localStorage → 显示"获取课程"。
--
-- 把已获取落到服务端之后：
--   1. 清缓存/换设备/换浏览器都不会丢；
--   2. 详情页与列表页读的是同一份事实，"列表里有、点进去说没有"这类矛盾从根上消失；
--   3. 将来要做"获取人数"、推荐、或者把获取与付费打通，也有据可依。
--
-- 为什么单独建表而不是加一列到 user_course_progress：
--   两者语义不同 —— 「已获取」是用户主动加进我的课程（一种收藏/intent），
--   「进度」是真练过。混在一张表里，将来任何一边的语义变化都会牵连另一边；
--   而且 progress 行是 upsert 的单行状态，获取则是可增可减的集合。
--
-- 是否需要手动执行：需要（仓库没有迁移执行器，见 db/README.md）。
-- 只建表，不动既有数据。

CREATE TABLE IF NOT EXISTS `user_acquired_courses` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `course_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- 同一用户对同一门课只能有一条：接口用 upsert，这里由唯一键兜底防重复
  UNIQUE KEY `uk_user_course_acquired` (`user_id`, `course_id`),
  -- 列表页按用户查，走这个索引
  KEY `idx_user_acquired_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
