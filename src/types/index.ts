export interface User {
  id: string
  phone?: string | null
  name?: string | null
  avatar?: string | null
  level: number
  total_score: number
  is_pro: boolean
  pro_expires?: string | null
  created_at: string
}

export interface Sentence {
  id: string
  chinese: string
  english: string
  words_count: number
  category: string
  difficulty: number // 1=简单 2=中等 3=较难
  tags: string[]
}

export interface Scene {
  key: string
  label: string
  labelEn: string
  description: string
  icon: string
  color: string
}

export const SCENES: Scene[] = [
  {
    key: "daily",
    label: "日常对话",
    labelEn: "Daily Conversation",
    description: "日常生活常用表达",
    icon: "MessageCircle",
    color: "#6366F1",
  },
  {
    key: "travel",
    label: "出行旅游",
    labelEn: "Travel",
    description: "旅行途中必备英语",
    icon: "Plane",
    color: "#3B82F6",
  },
  {
    key: "workplace",
    label: "职场英语",
    labelEn: "Workplace",
    description: "工作场景专业表达",
    icon: "Briefcase",
    color: "#22C55E",
  },
  {
    key: "social",
    label: "社交媒体",
    labelEn: "Social Media",
    description: "线上聊天常用语",
    icon: "Share2",
    color: "#F59E0B",
  },
  {
    key: "movies",
    label: "影视台词",
    labelEn: "Movie Lines",
    description: "经典影视剧台词",
    icon: "Clapperboard",
    color: "#A855F7",
  },
  {
    key: "exam",
    label: "考试必备",
    labelEn: "Exam Prep",
    description: "四六级考研真题句",
    icon: "GraduationCap",
    color: "#EF4444",
  },
]

export interface PracticeRecord {
  id: string
  user_id: string
  sentence_id: string
  user_input: string
  score: number
  mistakes: number
  is_review: boolean
  created_at: string
}

export interface ReviewItem {
  id: string
  sentence_id: string
  user_wrong: string
  review_count: number
  consecutive_ok: number
  next_review_at: string
  status: "pending" | "graduated"
  chinese?: string
  english?: string
}

export interface PaymentOrder {
  id: string
  user_id: string
  plan: "monthly" | "yearly"
  amount: number
  out_trade_no: string
  transaction_id?: string
  code_url?: string
  status: "pending" | "paid" | "expired" | "cancelled"
  paid_at?: string
  created_at: string
  expires_at?: string
}

export interface Subscription {
  id: string
  user_id: string
  plan: "monthly" | "yearly"
  status: "active" | "cancelled" | "expired"
  payment_order_id?: string
  starts_at: string
  expires_at: string
  cancelled_at?: string
  created_at: string
}
