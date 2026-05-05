# 技术架构

---

## 技术选型

| 层 | 技术 | 选型理由 |
|---|------|---------|
| **前端框架** | Next.js 14+ (App Router) + TypeScript | React 生态，SSR/SSG 友好 |
| **样式** | Tailwind CSS + shadcn/ui | 快速开发，组件化 |
| **动效** | CSS Transition + Framer Motion（少量） | 轻量，克制使用 |
| **后端** | Next.js API Routes + Server Actions | 不额外部署后端服务 |
| **数据库** | Supabase (PostgreSQL) | 免费额度 500MB，够 MVP |
| **认证** | 微信开放平台 + 短信验证码服务 | 微信扫码 + 手机号登录 |
| **AI** | OpenAI API (GPT-4o-mini) | 成本低，效果好；备选国内大模型 |
| **部署** | Vercel (Hobby) | 免费，自动 CI/CD |
| **域名** | typenow.cn | 已确认 |
| **存储** | Supabase Storage | 分享卡片图片 |
| **监控** | Vercel Analytics（免费） | 页面访问 + 性能 |

---

## 数据库核心表

```sql
-- 用户
users
  id          uuid PK
  phone       text UNIQUE
  name        text
  avatar      text
  level       integer DEFAULT 1
  total_score integer DEFAULT 0
  is_pro      boolean DEFAULT false
  pro_expires timestamptz
  created_at  timestamptz DEFAULT now()

-- 句子库
sentences
  id          uuid PK
  chinese     text
  english     text
  words_count integer
  category    text      -- 场景分类
  difficulty  integer   -- 1 简单 2 中等 3 较难
  tags        text[]    -- ['past-tense', 'shopping']
  created_at  timestamptz DEFAULT now()

-- 练习记录
practice_records
  id          uuid PK
  user_id     uuid FK → users
  sentence_id uuid FK → sentences
  user_input  text
  score       integer   -- 10/6/2
  mistakes    integer   -- 错误次数
  is_review   boolean DEFAULT false
  created_at  timestamptz DEFAULT now()

-- 复习队列
review_queue
  id              uuid PK
  user_id         uuid FK → users
  sentence_id     uuid FK → sentences
  user_wrong      text
  review_count    integer DEFAULT 0
  consecutive_ok  integer DEFAULT 0
  next_review_at  timestamptz
  status          text DEFAULT 'pending'  -- pending/graduated
  created_at      timestamptz DEFAULT now()

-- AI 强化记录
strengthen_sessions
  id          uuid PK
  user_id     uuid FK → users
  type        text      -- quiz/chat/write
  analysis    jsonb     -- AI 薄弱点分析
  content     jsonb     -- AI 生成内容
  result      jsonb     -- 用户结果
  created_at  timestamptz DEFAULT now()

-- 写作记录
writing_entries
  id            uuid PK
  user_id       uuid FK → users
  topic         text
  original_text text
  ai_report     jsonb     -- 批改报告
  created_at    timestamptz DEFAULT now()

-- 成就
user_achievements
  id              uuid PK
  user_id         uuid FK → users
  achievement_key text
  unlocked_at     timestamptz DEFAULT now()

-- 订阅
subscriptions
  id          uuid PK
  user_id     uuid FK → users
  plan        text      -- monthly/yearly
  status      text      -- active/cancelled/expired
  starts_at   timestamptz
  expires_at  timestamptz
  created_at  timestamptz DEFAULT now()
```

---

## AI Prompt 架构

### Prompt 1: 薄弱点分析 + 出题（合并调用）

```
System: 你是英语教学分析助手。根据用户的练习记录，分析薄弱点并生成针对性练习题。
        输入包含：本轮练习的句子、用户输入、判分结果。
        输出 JSON：
        {
          "weak_points": [
            { "type": "past-tense", "count": 2, "examples": ["go→went"] }
          ],
          "quiz": [
            { "chinese": "中文句子", "english": "标准答案", "focus": "薄弱点" }
          ]
        }
```

### Prompt 2: 场景对话

```
System: 你是英语对话伙伴。根据用户的薄弱点，开展一段自然对话，有意识地引导用户使用相关语法。
        用 *italic* 隐式纠正用户错误（不中断对话，在回复中自然包含正确用法）。
        对话 6-8 轮后给出简短反馈。
        输出 JSON：{ "messages": [...], "feedback": "..." }
```

### Prompt 3: 写作批改

```
System: 你是英语写作批改老师。友好专业地批改用户的英文写作。
        保持原意，优化语法和表达。标注错误类型。强调用户做对了什么。
        输出 JSON：
        {
          "corrected": "优化后全文",
          "errors": [{ "original": "...", "correction": "...", "type": "..." }],
          "highlights": ["正面评价 1", "正面评价 2"],
          "tips": ["改进建议"]
        }
```

---

## AI 调用策略与成本

| 环节 | 用 AI？ | 说明 |
|------|---------|------|
| 单句判分 | ❌ | 规则词库匹配，零成本 |
| 同义词容错 | ❌ | 预设同义词库 |
| 薄弱点分析 | ✅ | 综合本轮错误，1 次 API 调用 |
| 出题练习 | ✅ | 和薄弱点分析合并 1 次调用 |
| 场景对话 | ✅ | 每轮对话 1-3 次 API 调用 |
| 写作批改 | ✅ | 1 次 API 调用 |

**成本估算（GPT-4o-mini）：**

| 项目 | 每次成本 | 频次 | 月成本/付费用户 |
|------|---------|------|---------------|
| 薄弱点分析 + 出题 | ¥0.03 | 每日 2 次 | ¥1.8 |
| 场景对话 | ¥0.05 | 每日 1 次 | ¥1.5 |
| 写作批改 | ¥0.03 | 每日 1 次 | ¥0.9 |
| **合计** | | | **≈ ¥4.2/月** |

> PRO 用户定价 ¥29/月，AI 成本约占 14%，健康。
