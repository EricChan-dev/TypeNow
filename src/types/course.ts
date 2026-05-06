export type CourseSource = "official" | "user"

export type SortMode = "latest" | "most_used" | "name"

export interface Course {
  id: string
  title: string
  coverUrl: string
  source: CourseSource
  sourceName: string
  sourceAvatar?: string
  learnerCount: number
  categoryKey: string
  subCategoryKey: string
  createdAt: string
  usageCount: number
  description: string
}

export interface Lesson {
  id: string
  courseId: string
  title: string
  summary: string
  order: number
}

export interface CourseCategory {
  key: string
  label: string
  subCategories: { key: string; label: string }[]
}

export const COURSE_CATEGORIES: CourseCategory[] = [
  { key: "all", label: "全部课程", subCategories: [] },
  {
    key: "graded_reading",
    label: "分级阅读",
    subCategories: [
      { key: "oxford_reading_tree", label: "牛津树" },
      { key: "raz", label: "RAZ" },
      { key: "heinemann", label: "海尼曼" },
      { key: "big_cat", label: "大猫分级阅读" },
      { key: "red_rocket", label: "红火箭" },
      { key: "lets_go", label: "Let's Go" },
      { key: "oxford_bookworm", label: "牛津书虫" },
    ],
  },
  {
    key: "school_sync",
    label: "中小学同步",
    subCategories: [
      { key: "grade_1", label: "一年级" },
      { key: "grade_2", label: "二年级" },
      { key: "grade_3", label: "三年级" },
      { key: "grade_4", label: "四年级" },
      { key: "grade_5", label: "五年级" },
      { key: "grade_6", label: "六年级" },
      { key: "grade_7", label: "七年级" },
      { key: "grade_8", label: "八年级" },
      { key: "grade_9", label: "九年级" },
      { key: "high_school", label: "高中" },
      { key: "vocational", label: "中职英语" },
    ],
  },
  {
    key: "exam_prep",
    label: "应试考试",
    subCategories: [
      { key: "zhongkao", label: "中考" },
      { key: "gaokao", label: "高考" },
      { key: "degree_english", label: "学位英语" },
      { key: "zhuan_sheng_ben", label: "专升本" },
      { key: "cet_4_6", label: "大学四六级" },
      { key: "postgraduate", label: "考研" },
      { key: "tem_4_8", label: "专四专八" },
      { key: "ielts_toefl", label: "雅思托福" },
      { key: "ket", label: "KET" },
      { key: "pet", label: "PET" },
      { key: "fce", label: "FCE" },
      { key: "pte", label: "PTE" },
      { key: "gre", label: "GRE" },
      { key: "toeic", label: "托业" },
    ],
  },
  {
    key: "practical",
    label: "实用英语",
    subCategories: [
      { key: "listening_speaking", label: "听力口语" },
      { key: "classic_textbooks", label: "经典教材" },
      { key: "grammar_vocab", label: "语法词汇" },
      { key: "daily_oral", label: "日常口语" },
      { key: "travel_english", label: "旅游英语" },
      { key: "business_career", label: "商务职场" },
      { key: "movies_stories", label: "电影与故事" },
    ],
  },
]

export const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "latest", label: "最新发布" },
  { key: "most_used", label: "最多使用" },
  { key: "name", label: "课程名称" },
]
