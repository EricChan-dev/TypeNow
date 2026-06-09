# 句乐部课程数据导入方案

## 一、数据结构对比与优化

### 句子级字段对照

| TypeNow 当前 | 句乐部 | 导入后 |
|-------------|--------|--------|
| `words[].phonetic: string` | `wordDetails[].phonetic: {uk, us}` | ✅ 改为 `{uk, us}` 对象 |
| `words[].chinese: string` | `wordDetails[].definition: string` | ✅ 新增 `definition` 详细释义 |
| `words[].pos: 动词/名词...` | `wordDetails[].pos: VERB/NOUN...` | ✅ 英文缩写，前端映射 |
| ❌ 无 | `dependencyAnalysis` 完整依存语法树 | ✅ 新增 JSONB 列 |
| ❌ 无 | `sentenceStructure` 主谓宾定状补 | ✅ 新增 JSONB 列 |
| `chunks[]` | `wordGroups` | 保留现有 |

### 课程结构映射

```
句乐部 CoursePack  →  TypeNow Course  (课程包 → 课程)
     └── Course[1..N]  →  TypeNow Lesson  (每课 → 章节)
          └── Sentence[1..N]  →  TypeNow Sentence  (增强字段)
```

---

## 二、已创建的文件

### 1. Schema 迁移
- `supabase/migrations/00010_julebu_sentence_enrichment.sql`
  - 新增 `dependency_analysis JSONB`
  - 新增 `sentence_structure JSONB`

### 2. Drizzle Schema
- `src/lib/db/schema.ts` — sentences 表新增 `dependencyAnalysis` 和 `sentenceStructure` 字段

### 3. TypeScript 类型
- `src/types/index.ts` — 新增 `Phonetic`, `DependencyAnalysis`, `SentenceComponent` 接口
- `Word` 接口的 `phonetic` 改为 `string | Phonetic | null`（兼容新旧格式）

### 4. 导入脚本
- `scripts/import-julebu.ts`
- `package.json` 新增 `"import-julebu": "tsx scripts/import-julebu.ts"`

---

## 三、导入流程

```
┌─────────────────────────────────────────────┐
│ Step 1: Node.js API（无需浏览器）              │
│  mall.search → 课程包列表                      │
│  mall.getCoursePackDetail → 课程元数据          │
│  userCoursePacks.list → 用户的课程包            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ Step 2: Puppeteer（浏览器上下文）               │
│  导航到课程包详情页                             │
│  → 点击"继续学习" → 点击"继续练习"               │
│  → 拦截 courses.findOne 响应                  │
│  → 提取 218 句/课的完整数据                      │
│  数据缓存到 .data/julebu/sentences-{id}.json   │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ Step 3: Transform + Insert                   │
│  JulebuSentence → TypeNow Sentence           │
│  CoursePack → Course                         │
│  Course → Lesson                             │
│  写入 MySQL 数据库                             │
└─────────────────────────────────────────────┘
```

---

## 四、使用方法

### 环境准备
```bash
# 1. 从浏览器登录 julebu.co 后，复制 cookie
# Chrome DevTools → Application → Cookies → 复制所有 cookie 值

# 2. 设置环境变量
export JULEBU_COOKIE='_clck=...; __Secure-julebu.session_token=...; ...'

# 3. 运行迁移（Supabase/MySQL）
# supabase db push 或手动执行 00010_julebu_sentence_enrichment.sql

# 4. 安装 puppeteer（如果尚未安装）
pnpm add -D puppeteer
```

### 导入命令
```bash
# 导入全部用户课程包
pnpm import-julebu

# 仅导入指定课程包
JULEBU_TARGET_PACKS=rwtocajplud9ld732ep5u8ec pnpm import-julebu

# 限制每个课程包的课程数
JULEBU_MAX_COURSES=3 pnpm import-julebu

# 跳过 Puppeteer（使用已缓存数据直接写 DB）
SKIP_PUPPETEER=1 pnpm import-julebu
```

---

## 五、已提取的示例数据

| 项目 | 值 |
|------|-----|
| 课程包 | 星荣零基础学英语（new） |
| 课程包 ID | `rwtocajplud9ld732ep5u8ec` |
| 课程数 | 61 课 |
| 第1课句子数 | 218 句 |
| 数据大小 | ~516KB JSON |
| 逐词分析 | ✅ wordDetails（音标 uk/us + 词性 + 释义）|
| 语法树 | ✅ dependencyAnalysis（nodes + edges） |
| 成分标注 | ✅ sentenceStructure（主谓宾定状补） |

### 单句数据示例
```json
{
  "english": "I like",
  "chinese": "我喜欢",
  "wordDetails": [
    {"word": "I", "pos": "PRON", "phonetic": {"uk": "aɪ", "us": "aɪ"}, "definition": "我"},
    {"word": "like", "pos": "VERB", "phonetic": {"uk": "laɪk", "us": "laɪk"}, "definition": "喜欢"}
  ],
  "dependencyAnalysis": {
    "root": 1,
    "edges": [{"label": "nsubj", "source": 1, "target": 0}],
    "nodes": [
      {"id": 0, "dep": "nsubj", "pos": "PRON", "word": "I", "lemma": "I", "phrase": "I"},
      {"id": 1, "dep": "ROOT", "pos": "VERB", "word": "like", "lemma": "like", "phrase": "I like"}
    ]
  },
  "sentenceStructure": [
    {"role": "主语", "text": "I", "type": "subject", "explanation": "这是一个代词..."},
    {"role": "谓语", "text": "like", "type": "predicate", "explanation": "这是一个实义动词..."}
  ]
}
```

---

## 六、技术要点

### API 版本校验
`courses.findOne` 有页面版本校验（"页面版本过旧"），必须在 **浏览器页面上下文中** 调用：
- Node.js 直接 fetch → ❌ 报 "页面版本过旧"
- Puppeteer page.evaluate fetch → ❌ 同样报错
- Puppeteer 导航到页面后，**点击 UI 按钮触发页面自身的 API 调用** → ✅ 成功

### 正确的页面导航路径
```
julebu.co/my-course-packs/{coursePackId}
  → 点击 "继续学习「第X课」"
  → 点击 "继续练习" / "重新开始"
  → 页面自动调 courses.findOne → 拦截响应
  → 最终跳转到 game/course/{packId}/{courseId}?mode=...
```

### tRPC API 调用格式
```typescript
// Query (GET)
const bi = { "0": { json: <input> } }  // ⚠️ 不需要 meta 字段
const url = `https://api.julebu.co/trpc/${endpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(bi))}`

// Mutation (POST)
const url = `https://api.julebu.co/trpc/${endpoint}?batch=1`
body: JSON.stringify({ "0": { json: <input> } })
```

### 需要注意的端点
| 端点 | 类型 | 版本校验 | 说明 |
|------|------|---------|------|
| `mall.getCoursePackCategories` | GET | ❌ | 197 个分类 |
| `mall.search` | GET | ❌ | 1981 个课程包 |
| `mall.getCoursePackDetail` | GET | ❌ | 课程包+课程列表 |
| `userCoursePacks.list` | GET | ❌ | 用户的课程包 |
| `courses.findOne` | GET | ✅ | **必须浏览器上下文** |
| `courses.findCourseLearningContent` | GET | ✅ | 学习内容 |
| `practice.getCourseGameMeta` | GET | ❌ | 练习模式/难度 |
| `practice.createSession` | POST | ❌ | 创建练习会话 |
| `practice.getExistingSessionDetail` | GET | ❌ | 会话进度 |
