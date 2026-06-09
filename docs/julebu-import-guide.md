# 句乐部课程数据导入 · 完整操作指南

## 概述

将句乐部（julebu.co）课程包数据导入 TypeNow 数据库，包括：
- 课程包 → Course（课程）
- 每课 → Lesson（章节）
- 每句 → Sentence（句子，含逐词分析 + 语法树 + 成分标注）

## Schema 变更

在 `sentences` 表新增 2 个 JSON 列：

| 列名 | 类型 | 说明 |
|------|------|------|
| `dependency_analysis` | JSON | 依存语法树 — nodes（词节点）、edges（依存边）、root（根节点） |
| `sentence_structure` | JSON | 句子成分标注 — role（主语/谓语/宾语…）、text、type、explanation |

`words` JSONB 字段的 `phonetic` 从 `string` 改为 `{uk, us}` 对象格式。

Migration 文件: `supabase/migrations/00010_julebu_sentence_enrichment.sql`

## 快速开始

### 前置条件
```bash
# 1. 安装 puppeteer（用于爬取）
cd /tmp && npm install puppeteer --ignore-scripts

# 2. 从浏览器获取 Cookie
#    Chrome → julebu.co → F12 → Application → Cookies → 复制所有 cookie 值
export JULEBU_COOKIE='_clck=...; __Secure-julebu.session_token=...; __Secure-julebu.session_data=...; _clsk=...'

# 3. 执行迁移
npx tsx -e "
const {config} = require('dotenv'); config();
const mysql = require('mysql2/promise');
(async()=>{
  const p=mysql.createPool(process.env.DATABASE_URL);
  for(const c of ['dependency_analysis','sentence_structure']){
    try{await p.execute('ALTER TABLE sentences ADD COLUMN '+c+' JSON');console.log('OK:',c)}
    catch(e){if(e.message.includes('Duplicate'))console.log('SKIP:',c,'(exists)');else throw e}
  }
  await p.end(); console.log('Migration done');
})();
"
```

### 完整导入流程

```bash
# Step 1: 爬取全部课程数据（Puppeteer，约 10-15 分钟）
JULEBU_TARGET_PACKS=rwtocajplud9ld732ep5u8ec node /tmp/julebu-crawl-all.mjs

# Step 2: 用缓存数据导入数据库
SKIP_PUPPETEER=1 JULEBU_TARGET_PACKS=rwtocajplud9ld732ep5u8ec pnpm import-julebu

# Step 3: 验证
# 打开 TypeNow → 进入课程 → 开始练习 → 完成句子后可见带音标的词性卡片
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JULEBU_COOKIE` | 句乐部登录 cookie（必需） | - |
| `JULEBU_TARGET_PACKS` | 目标课程包 ID（逗号分隔） | 全部用户课程包 |
| `JULEBU_MAX_COURSES` | 每包最大课程数 | 全部 |
| `SKIP_PUPPETEER` | 跳过爬取，仅从缓存导入 | 否 |
| `SKIP_DB` | 仅爬取不写库 | 否 |

## 数据映射

### Course（课程包 → 课程）
```
Julebu CoursePack           TypeNow Course
├── title          →        title
├── description    →        description
└── source         →        "official" / sourceName = "句乐部"
```

### Lesson（课程 → 章节）
```
Julebu Course              TypeNow Lesson
├── title          →        title
├── description    →        summary
└── order          →        sortOrder
```

### Sentence（句子 → 增强字段）
```
Julebu Sentence       TypeNow Sentence
├── english          → english
├── chinese          → chinese
├── sortOrder        → sortOrder
├── wordDetails[]    → words[] (phonetic 改为 {uk,us} + 新增 definition)
├── dependencyAnalysis → dependency_analysis (JSON)
└── sentenceStructure  → sentence_structure (JSON)
```

### Word 字段变更
```
旧: {english, chinese, phonetic: "/aɪ/", pos: "代词"}
新: {english, chinese, phonetic: {uk: "aɪ", us: "aɪ"}, definition: "我", pos: "PRON"}
```

## 前端改动

### 已改动文件

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | 新增 `Phonetic`、`DependencyAnalysis`、`SentenceComponent` 接口；`Word.phonetic` 改为 `string \| Phonetic \| null` |
| `src/components/home/learn/CompletedSentence.tsx` | `phoneticDisplay()` 兼容新旧格式；POS_COLOR 新增英文词性 13 色体系 |
| `src/lib/db/schema.ts` | sentences 表新增 `dependencyAnalysis`、`sentenceStructure` 列 |

### 无需改动

- **API `/api/courses/sentences`** — 使用 `db.select()` 自动返回所有列
- **LearnClient.tsx** — words 数组结构向后兼容
- **WordDetailPopover** — 独立的词典查询 popover，不依赖 sentence.words

### 音标展示逻辑

```typescript
// CompletedSentence.tsx
function phoneticDisplay(phonetic: Word["phonetic"]): string {
  if (!phonetic) return " "
  if (typeof phonetic === "string") return phonetic  // 旧格式
  return phonetic.uk || phonetic.us || " "           // 新格式：默认英式
}
// hover 时 title 显示美式音标
```

## 技术要点

### API 认证
- 基础 API（mall.search, mall.getCoursePackDetail）可通过 Node.js fetch 调用
- `courses.findOne` 有页面版本校验，必须通过 Puppeteer 浏览器上下文调用
- 正确流程：导航到课程包详情页 → 点击"继续学习→第X课" → 点击"继续练习" → 页面自动调 courses.findOne

### tRPC 调用格式
```typescript
// ⚠️ 不要包含 meta 字段
const bi = { "0": { json: <input> } }  // json: null 表示无参数
const url = `https://api.julebu.co/trpc/${endpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(bi))}`
```

### 断点续传
- 每课数据缓存到 `.data/julebu/sentences-{courseId}.json`
- 重新运行会自动跳过已缓存的课程
- 包元数据缓存到 `.data/julebu/packs-metadata.json`

## 文件清单

| 文件 | 用途 |
|------|------|
| `supabase/migrations/00010_julebu_sentence_enrichment.sql` | Schema 迁移 SQL |
| `scripts/import-julebu.ts` | 3-Phase 导入脚本（元数据 + 爬取 + 入库） |
| `src/lib/db/schema.ts` | Drizzle schema（新增 2 列） |
| `src/types/index.ts` | TypeScript 类型更新 |
| `src/components/home/learn/CompletedSentence.tsx` | 前端组件（双音标 + 词性色标） |
| `docs/julebu-import-plan.md` | 技术方案文档 |
| `docs/julebu-import-guide.md` | 本操作指南 |
| `/tmp/julebu-crawl-all.mjs` | 批量爬虫（Puppeteer） |
