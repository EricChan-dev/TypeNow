# TypeNow 对齐句乐部数据结构

## Context

TypeNow 原本就是参考句乐部模式做的。现在拿到了句乐部的完整数据模型，可以针对性补齐差距。

## 差距分析

### 1. Word 层（可直接优化）

| 字段 | TypeNow 现有 | 句乐部 | 差距 |
|------|-------------|--------|------|
| 单词 | `words[].english` | `wordDetails[].word` | 同名 |
| 词性 | `words[].pos` | `wordDetails[].pos` | TypeNow 用中文（"动词"），句乐部用英文缩写（"VERB"），建议统一为英文 |
| 音标 | `words[].phonetic`（单一字符串） | `phonetic.uk` + `phonetic.us` | 缺少英美音标拆分 |
| 释义 | 无（需额外调 `/api/dict/word`） | `wordDetails[].definition` | **缺少内联释义** |

**建议改动：**
- `src/types/index.ts` 的 `Word` 接口增加 `definition?: string`，`phonetic` 改为 `{uk?: string; us?: string}`
- `src/lib/db/schema.ts` 的 `sentences.words` JSONB 结构同步更新

### 2. 句子层（数据导入角度）

TypeNow 已有 `chinese`、`english`、`words`、`chunks`、`sortOrder`，与句乐部的 `english`、`chinese`、`sortOrder`、`wordDetails` 基本对应。

### 3. 缺失的结构化数据

| 句乐部字段 | TypeNow 现状 | 价值 |
|-----------|-------------|------|
| `dependencyAnalysis` | 无 | **语法依存树**——可做可视化句子树 |
| `sentenceStructure` | 无（`SentenceKnowledge` 有 free-text 语法分析） | **结构化语法角色**——主谓宾标注+解释 |
| `wordGroups` | 无（`chunks` 是简化版） | 语块组合——渐进式难度控制 |

**这两项数据量大且需要 NLP 能力**，句乐部应该是用 spaCy 或类似工具预生成的。TypeNow 可以通过以下方式补齐：
- A) 调用 DeepSeek 生成（已有 `analyzeSentence()`，可扩展 prompt）
- B) 导入句乐部数据时一并带入
- C) 用前端 JS NLP 库（compromise/compromise-dependency）做轻量解析

### 4. SentenceKnowledge 关联

TypeNow 的 `sentence_knowledge` 表按文本 hash 查找，没有直接关联 `sentences.id`。句乐部则是数据与句子 ID 紧耦合。可在导入数据时把 AI 分析结果直接写入 `sentence_knowledge` 表。

## 建议实施顺序

### 第一步：Word 类型升级（小改动，高价值）

修改 `src/types/index.ts` 的 `Word` 接口：
```typescript
export interface Word {
  english: string
  chinese: string | null
  phonetic: string | null  // 保持兼容，或改为 {uk?: string; us?: string}
  phoneticUk?: string      // 新增
  phoneticUs?: string      // 新增
  pos: string
  definition?: string      // 新增：内联释义
}
```

### 第二步：数据导入脚本

写一个脚本读取句乐部 `courses.findOne` API 的完整响应，转换为 TypeNow 的 Sentence 格式后批量写入数据库。

### 第三步：语法树生成（按需）

如果需要句子树可视化，扩展 `analyzeSentence()` 的 prompt 让它同时返回 dependency parse 和 sentence structure。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | Word 接口增加 definition、phoneticUk/phoneticUs |
| `src/lib/db/schema.ts` | sentences.words JSONB 类型更新 |
| `src/components/home/learn/CompletedSentence.tsx` | 展示 definition（如有） |

## 验证

1. 类型检查通过
2. 现有练习页面正常加载句子
3. 新字段不影响现有数据的读取
