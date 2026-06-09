-- 00010_julebu_sentence_enrichment.sql
-- 新增句乐部导入所需的句子增强字段

-- Add dependency grammar tree (依存语法树)
ALTER TABLE sentences
  ADD COLUMN IF NOT EXISTS dependency_analysis JSONB
  COMMENT '依存语法树（来自句乐部/外部导入），含 nodes, edges, root, sentence';

-- Add sentence structure analysis (句子成分标注)
ALTER TABLE sentences
  ADD COLUMN IF NOT EXISTS sentence_structure JSONB
  COMMENT '句子成分标注（来自句乐部/外部导入），含 role, text, type, explanation';

-- Note: words JSONB 字段保持不变。
-- 导入时 phonetic 从 string 改为 {uk, us} 对象格式，
-- pos 保持英文缩写（VERB/NOUN/PRON...），前端展示时映射。
-- 新增 definition 字段在 words 数组的每个元素中。
