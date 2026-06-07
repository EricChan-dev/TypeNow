# 句乐部竞品技术调研

## 概述

对 [句乐部 (julebu.co)](https://julebu.co) 进行了完整的技术调研，包括产品功能分析、数据模型逆向、API 端点梳理和句子级数据结构提取。

## 产品对比

| 维度 | 句乐部 | TypeNow |
|------|--------|---------|
| 核心玩法 | 连词成句（排序拼句） | 键盘打字（中译英） |
| 用户量 | 70万+ | - |
| 价格 | 39元/月 | 29元/月 / 199元/年 |
| 课程包 | 699个 | - |
| 练习模式 | 中译英、听写、听力、口语评测（4种） | 中译英打字（1种） |
| 难度体系 | 初级/中级/高级/自定义，i+1渐进 | 简单/中等/较难 |
| 音标 | 英美双音标拆分（uk+us） | 单一音标字符串 |
| 语法分析 | 依存语法树 + 句子成分标注 | AI free-text 语法分析 |
| 自定义内容 | 编辑端导入 | Pro功能（标记中） |
| 合伙人/分销 | 无 | 有 |
| 平台 | Nuxt SPA（PC端为主） | Next.js（响应式） |

## 数据模型（句乐部）

### API 端点清单

#### 课程相关
| 端点 | 方法 | 说明 |
|------|------|------|
| `mall.search` | query | 课程包搜索，支持分类、排序、分页 |
| `mall.getCoursePackDetail` | query | 课程包详情，含全部课程列表 |
| `mall.getCoursePackCategories` | query | 课程包分类列表 |
| `courses.findOne` | query | 单个课程完整数据，含全部句子 |
| `courses.findCourseLearningContent` | query | 课程学习内容（单词释义等） |
| `courses.findSentenceLearningContent` | query | 单句学习内容 |

#### 练习相关
| 端点 | 方法 | 说明 |
|------|------|------|
| `practice.getCourseGameMeta` | query | 游戏元数据（模式、难度） |
| `practice.createSession` | mutate | 创建练习会话 |
| `practice.completeSession` | mutate | 完成练习会话 |
| `practice.getExistingSessionDetail` | query | 获取进行中的会话 |
| `practice.abandonSession` | mutate | 放弃会话 |
| `practice.getCoursePackLearningPathProgress` | query | 学习路线进度 |
| `practice.getCourseLearningAnalytics` | query | 课程学习分析 |
| `practice.getHighlightMoments` | query | 高光时刻 |

#### 音频相关
| 端点 | 说明 |
|------|------|
| `audios.getSentenceAudioUrl` | 获取句子发音 URL |
| `audios.checkCourseAudioExistence` | 检查课程音频是否存在 |
| `/api/audio?text=...` | 逐词/逐句 TTS 音频 |

#### 其他
| 端点 | 说明 |
|------|------|
| `userLearningCheckIn.getCheckInStatus` | 签到状态 |
| `userLearnHistory.upsert` | 学习记录写入 |
| `userLearnHistory.findUserLearnHistories` | 学习历史 |
| `masteredElements.list` | 已掌握内容列表 |
| `statementNotes.findByStatement` | 句子笔记 |
| `coursePackRatings.getSummary` | 课程包评分汇总 |
| `coursePackRatings.getReviews` | 课程包评价列表 |
| `recommendation.getRecommendations` | 推荐课程 |
| `feedbacks.create` | 创建反馈 |

### 句子数据结构

```typescript
interface JulebuSentence {
  id: string
  content: string          // 原始内容
  english: string          // 英文文本
  chinese: string          // 中文翻译
  sortOrder: number        // 课内排序

  // 逐词分析
  wordDetails: Array<{
    word: string
    pos: string            // 词性（PRON/VERB/DET/NOUN/AUX/ADJ/ADV/ADP/CONJ/INTJ/NUM/PART/PROPN）
    phonetic: {
      uk: string           // 英式音标 IPA
      us: string           // 美式音标 IPA
    }
    definition: string     // 中文释义
  }>

  // 依存语法树
  dependencyAnalysis: {
    root: number
    edges: Array<{
      label: string        // 依存关系标签（nsubj/dobj/det/...）
      source: number
      target: number
    }>
    nodes: Array<{
      id: number
      dep: string          // 依存角色（ROOT/nsubj/dobj/det/...）
      pos: string          // 词性
      tag: string          // Penn Treebank 标签
      head: string         // 中心词
      word: string
      lemma: string        // 词元
      phrase: string       // 短语
      children: number[]
      left_edge: number
      right_edge: number
      start_idx: number
      end_idx: number
    }>
  }

  // 句子成分分析（中文标注）
  sentenceStructure: Array<{
    start: number
    end: number
    role: string           // 语法角色（主语/谓语/宾语/状语/...）
    text: string
    type: string           // 类型（subject/predicate/object/adverbial/...）
    explanation: string    // 中文解释
  }>

  // 语块组合
  wordGroups: null | Array<...>
}
```

### 词性颜色映射

从 JS 源码中提取的词性配色方案：
```javascript
NOUN: "#3b82f6"       // 蓝色
VERB: "#22c55e"       // 绿色
ADJ:  "#a855f7"       // 紫色
ADV:  "#eab308"       // 黄色
PRON: "#ef4444"       // 红色
ADP:  "#6366f1"       // 靛蓝（介词）
CONJ: "#ec4899"       // 粉色（连词）
INTJ: "#f97316"       // 橙色（感叹词）
DET:  "#14b8a6"       // 青色（冠词）
AUX:  "#22c55e"       // 绿色（助动词）
PROPN:"#3b82f6"       // 蓝色（专有名词）
NUM:  "#a855f7"       // 紫色（数词）
PART: "#6b7280"       // 灰色（小品词）
```

### 难度体系与练习预设

```
presetKey  | sentence | chunk | combinedChunks | phraseAndWord
-----------|----------|-------|----------------|--------------
beginner   | ✓        | ✓     | ✓              | ✓
intermediate| ✓       | ✓     | ✓              | ✗
advanced   | ✓        | ✗     | ✗              | ✗
custom     | ✓        | ✓     | ✓              | ✓
```

### 练习模式快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+M | 标记掌握 |
| Ctrl+N | 加入生词本 |
| Ctrl+P | 暂停/继续 |
| Ctrl+; | 显示答案 |
| Ctrl+1 | 查看学习内容 |
| Ctrl+2 | 句子树开关 |
| Ctrl+/ | AI助手 |
| Space | 确认/口语识别 |

## 爬取过程

### 技术路线

1. **Cookie 导入**：通过 gstack browse 的 `cookie-import-browser` 从 Chrome 导入句乐部登录态
2. **JS 拦截器注入**：在页面上下文注入 fetch/XHR 拦截器，捕获所有 tRPC API 响应
3. **Nuxt 源码逆向**：下载全部 147 个 JS chunk 文件，grep 提取 tRPC 端点名
4. **游戏引擎穿透**：句乐部练习界面基于 Canvas 渲染，DOM 不含句子数据，需通过 API 拦截获取

### 关键文件

拦截器脚本位于 `/tmp/julebu-intercept3.js`，核心逻辑：
```javascript
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await origFetch.apply(this, args);
  const url = /* extract URL */;
  if (url.includes('trpc') || url.includes('api.julebu')) {
    const clone = response.clone();
    clone.text().then(body => {
      window.__capturedData.push({ url, body, timestamp: Date.now() });
    });
  }
  return response;
};
```

### 遇到的坑

1. **tRPC 401**：curl 直接调 API 报 UNAUTHORIZED，必须在页面上下文通过 fetch with credentials 调用
2. **页面版本校验**：直接从控制台 fetch 会报"页面版本过旧"，需要页面刷新后立即调用
3. **JSON 截断**：`courses.findOne` 响应超过 200KB，`JSON.parse` 失败，改用正则按字段提取
4. **Canvas 渲染**：游戏 UI 是 Canvas/WebGL，DOM 中无句子内容，必须拦截网络层
5. **会员付费墙**：试用过期后游戏入口被拦截，`courses.findOne` 等端点也返回 401

## TypeNow 可借鉴的改进

### 数据层
- **Word 接口增加 `definition` 字段**：避免每次查词都要调 `/api/dict/word`
- **音标拆分为 uk/us**：`phonetic: {uk: string, us: string}`
- **词性统一为英文缩写**：VERB/NOUN/PRON 替代 动词/名词/代词，展示时再映射

### 功能层
- **练习模式多样化**：听写、听力、口语评测（句乐部有 4 种模式）
- **i+1 渐进式难度**：先单词 → 短语 → 完整句，自动递进
- **依存语法树可视化**：利用 `dependencyAnalysis` 数据做句子结构图
- **句子成分标注**：主谓宾定状补的角色标注 + 中文解释

### 体验层
- **快捷键体系**：句乐部有 12+ 个键盘快捷键，TypeNow 目前只有 5 个
- **词性颜色统一**：参考句乐部的 13 色词性体系
- **学习路线/大纲**：课程包级别的学习路径规划

## 备注

- 调研时间：2026年6月7日
- 句乐部会员：已开通（月付）
- 已提取的数据：星荣零基础第1课 218 句完整数据（含音标、词性、释义、语法树）
- 完整 61 课数据可通过 `courses.findOne` API 逐课批量获取
