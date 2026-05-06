import type { Course } from "@/types/course"

const officialAvatar = undefined
const now = new Date()

function daysAgo(d: number) {
  const date = new Date(now)
  date.setDate(date.getDate() - d)
  return date.toISOString()
}

export const mockCourses: Course[] = [
  // ===== 分级阅读 - 牛津树 =====
  { id: "gr_ot_01", title: "牛津阅读树 Level 1 - At the Park", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2340, categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree", createdAt: daysAgo(120), usageCount: 4520 },
  { id: "gr_ot_02", title: "牛津阅读树 Level 2 - The Lost Teddy", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1890, categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree", createdAt: daysAgo(90), usageCount: 3210 },

  // ===== 分级阅读 - RAZ =====
  { id: "gr_rz_01", title: "RAZ Level A - My Dog", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 3120, categoryKey: "graded_reading", subCategoryKey: "raz", createdAt: daysAgo(150), usageCount: 6780 },
  { id: "gr_rz_02", title: "RAZ Level B - At the Zoo", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2670, categoryKey: "graded_reading", subCategoryKey: "raz", createdAt: daysAgo(100), usageCount: 5430 },

  // ===== 分级阅读 - 海尼曼 =====
  { id: "gr_hn_01", title: "海尼曼 GK - Going Sledding", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1560, categoryKey: "graded_reading", subCategoryKey: "heinemann", createdAt: daysAgo(80), usageCount: 2890 },
  { id: "gr_hn_02", title: "海尼曼 G1 - The New Puppy", coverUrl: "", source: "user", sourceName: "王老师", sourceAvatar: undefined, learnerCount: 890, categoryKey: "graded_reading", subCategoryKey: "heinemann", createdAt: daysAgo(45), usageCount: 1340 },

  // ===== 分级阅读 - 大猫分级阅读 =====
  { id: "gr_bc_01", title: "大猫分级阅读 Pink A - In the Garden", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1230, categoryKey: "graded_reading", subCategoryKey: "big_cat", createdAt: daysAgo(70), usageCount: 2100 },
  { id: "gr_bc_02", title: "大猫分级阅读 Red A - The Magic Show", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 980, categoryKey: "graded_reading", subCategoryKey: "big_cat", createdAt: daysAgo(55), usageCount: 1670 },

  // ===== 分级阅读 - 红火箭 =====
  { id: "gr_rr_01", title: "红火箭 Early Level 1 - Fruit Salad", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1450, categoryKey: "graded_reading", subCategoryKey: "red_rocket", createdAt: daysAgo(110), usageCount: 2980 },
  { id: "gr_rr_02", title: "红火箭 Early Level 2 - My Family", coverUrl: "", source: "user", sourceName: "李老师", sourceAvatar: undefined, learnerCount: 720, categoryKey: "graded_reading", subCategoryKey: "red_rocket", createdAt: daysAgo(30), usageCount: 980 },

  // ===== 分级阅读 - Let's Go =====
  { id: "gr_lg_01", title: "Let's Go 1 - Hello, I'm Tom", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2100, categoryKey: "graded_reading", subCategoryKey: "lets_go", createdAt: daysAgo(130), usageCount: 4560 },
  { id: "gr_lg_02", title: "Let's Go 2 - What's This?", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1780, categoryKey: "graded_reading", subCategoryKey: "lets_go", createdAt: daysAgo(95), usageCount: 3120 },

  // ===== 分级阅读 - 牛津书虫 =====
  { id: "gr_ob_01", title: "牛津书虫 - 福尔摩斯探案", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 3450, categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm", createdAt: daysAgo(200), usageCount: 8900 },
  { id: "gr_ob_02", title: "牛津书虫 - 傲慢与偏见", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2890, categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm", createdAt: daysAgo(180), usageCount: 7200 },

  // ===== 中小学同步 =====
  { id: "ss_g1_01", title: "一年级英语上册 - Unit 1 School", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5670, categoryKey: "school_sync", subCategoryKey: "grade_1", createdAt: daysAgo(300), usageCount: 12340 },
  { id: "ss_g2_01", title: "二年级英语上册 - Unit 2 My Family", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4890, categoryKey: "school_sync", subCategoryKey: "grade_2", createdAt: daysAgo(280), usageCount: 10200 },
  { id: "ss_g3_01", title: "三年级英语上册 - Unit 3 Animals", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 6780, categoryKey: "school_sync", subCategoryKey: "grade_3", createdAt: daysAgo(260), usageCount: 15670 },
  { id: "ss_g4_01", title: "四年级英语上册 - Unit 4 Weather", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5230, categoryKey: "school_sync", subCategoryKey: "grade_4", createdAt: daysAgo(240), usageCount: 11200 },
  { id: "ss_g5_01", title: "五年级英语上册 - Unit 5 Food", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4560, categoryKey: "school_sync", subCategoryKey: "grade_5", createdAt: daysAgo(220), usageCount: 9800 },
  { id: "ss_g6_01", title: "六年级英语上册 - Unit 6 Hobbies", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4120, categoryKey: "school_sync", subCategoryKey: "grade_6", createdAt: daysAgo(200), usageCount: 8700 },
  { id: "ss_g7_01", title: "七年级英语上册 - Unit 7 School Life", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5430, categoryKey: "school_sync", subCategoryKey: "grade_7", createdAt: daysAgo(180), usageCount: 13400 },
  { id: "ss_g8_01", title: "八年级英语上册 - Unit 8 Travel", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4780, categoryKey: "school_sync", subCategoryKey: "grade_8", createdAt: daysAgo(160), usageCount: 10800 },
  { id: "ss_g9_01", title: "九年级中考复习 - 语法专题", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 7890, categoryKey: "school_sync", subCategoryKey: "grade_9", createdAt: daysAgo(140), usageCount: 18900 },
  { id: "ss_hs_01", title: "高中英语必修一 - Unit 1 Teenage Life", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 6230, categoryKey: "school_sync", subCategoryKey: "high_school", createdAt: daysAgo(120), usageCount: 14500 },
  { id: "ss_hs_02", title: "高中英语必修二 - Unit 2 History", coverUrl: "", source: "user", sourceName: "张老师", sourceAvatar: undefined, learnerCount: 3120, categoryKey: "school_sync", subCategoryKey: "high_school", createdAt: daysAgo(60), usageCount: 5600 },
  { id: "ss_vo_01", title: "中职英语 - 基础模块 1", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1890, categoryKey: "school_sync", subCategoryKey: "vocational", createdAt: daysAgo(90), usageCount: 3400 },

  // ===== 应试考试 =====
  { id: "ep_zk_01", title: "中考英语 - 完形填空专项训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 10230, categoryKey: "exam_prep", subCategoryKey: "zhongkao", createdAt: daysAgo(250), usageCount: 28900 },
  { id: "ep_zk_02", title: "中考英语 - 阅读理解高频词汇", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 8760, categoryKey: "exam_prep", subCategoryKey: "zhongkao", createdAt: daysAgo(200), usageCount: 21300 },
  { id: "ep_gk_01", title: "高考英语 - 写作高分模板", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 13450, categoryKey: "exam_prep", subCategoryKey: "gaokao", createdAt: daysAgo(300), usageCount: 35600 },
  { id: "ep_gk_02", title: "高考英语 - 长难句分析", coverUrl: "", source: "user", sourceName: "刘老师", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "exam_prep", subCategoryKey: "gaokao", createdAt: daysAgo(50), usageCount: 12300 },
  { id: "ep_de_01", title: "学位英语 - 核心词汇 3000", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 3450, categoryKey: "exam_prep", subCategoryKey: "degree_english", createdAt: daysAgo(150), usageCount: 7800 },
  { id: "ep_zsb_01", title: "专升本英语 - 翻译专项突破", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4560, categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben", createdAt: daysAgo(130), usageCount: 10200 },
  { id: "ep_cet_01", title: "大学英语四级 - 听力词汇通关", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 15670, categoryKey: "exam_prep", subCategoryKey: "cet_4_6", createdAt: daysAgo(350), usageCount: 45600 },
  { id: "ep_cet_02", title: "大学英语六级 - 翻译写作精练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 11230, categoryKey: "exam_prep", subCategoryKey: "cet_4_6", createdAt: daysAgo(300), usageCount: 32400 },
  { id: "ep_pg_01", title: "考研英语 - 阅读真题长难句", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 18900, categoryKey: "exam_prep", subCategoryKey: "postgraduate", createdAt: daysAgo(280), usageCount: 52300 },
  { id: "ep_tem_01", title: "专四 - 语法与词汇 1000 题", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5670, categoryKey: "exam_prep", subCategoryKey: "tem_4_8", createdAt: daysAgo(170), usageCount: 13400 },
  { id: "ep_ielts_01", title: "雅思 - 口语话题词汇库", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 12340, categoryKey: "exam_prep", subCategoryKey: "ielts_toefl", createdAt: daysAgo(220), usageCount: 31200 },
  { id: "ep_ielts_02", title: "托福 - 写作常用表达 200 句", coverUrl: "", source: "user", sourceName: "陈老师", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "exam_prep", subCategoryKey: "ielts_toefl", createdAt: daysAgo(40), usageCount: 9800 },
  { id: "ep_ket_01", title: "KET - 核心词汇 A-Z", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2340, categoryKey: "exam_prep", subCategoryKey: "ket", createdAt: daysAgo(100), usageCount: 5600 },
  { id: "ep_pet_01", title: "PET - 阅读写作冲刺", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1890, categoryKey: "exam_prep", subCategoryKey: "pet", createdAt: daysAgo(85), usageCount: 4300 },
  { id: "ep_fce_01", title: "FCE - 语法与词汇进阶", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 1200, categoryKey: "exam_prep", subCategoryKey: "fce", createdAt: daysAgo(70), usageCount: 2800 },
  { id: "ep_pte_01", title: "PTE - 听说读写全项训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 980, categoryKey: "exam_prep", subCategoryKey: "pte", createdAt: daysAgo(50), usageCount: 2100 },
  { id: "ep_gre_01", title: "GRE - 高频词汇 3000", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4560, categoryKey: "exam_prep", subCategoryKey: "gre", createdAt: daysAgo(160), usageCount: 12300 },
  { id: "ep_toeic_01", title: "托业 - 商务词汇与阅读", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 2340, categoryKey: "exam_prep", subCategoryKey: "toeic", createdAt: daysAgo(110), usageCount: 5600 },

  // ===== 实用英语 - 听力口语 =====
  { id: "pe_ls_01", title: "英语听力入门 - 日常对话 100 篇", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 7890, categoryKey: "practical", subCategoryKey: "listening_speaking", createdAt: daysAgo(200), usageCount: 18900 },
  { id: "pe_ls_02", title: "美式发音速成 - 音标与连读", coverUrl: "", source: "user", sourceName: "David老师", sourceAvatar: undefined, learnerCount: 3450, categoryKey: "practical", subCategoryKey: "listening_speaking", createdAt: daysAgo(30), usageCount: 6700 },

  // ===== 实用英语 - 经典教材 =====
  { id: "pe_ct_01", title: "新概念英语第一册 - 课文精讲", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 12340, categoryKey: "practical", subCategoryKey: "classic_textbooks", createdAt: daysAgo(400), usageCount: 34500 },
  { id: "pe_ct_02", title: "新概念英语第二册 - 句型训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 10230, categoryKey: "practical", subCategoryKey: "classic_textbooks", createdAt: daysAgo(350), usageCount: 28900 },

  // ===== 实用英语 - 语法词汇 =====
  { id: "pe_gv_01", title: "英语语法大全 - 时态专项练习", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 6780, categoryKey: "practical", subCategoryKey: "grammar_vocab", createdAt: daysAgo(180), usageCount: 15600 },
  { id: "pe_gv_02", title: "词根词缀记忆法 - 词汇量翻倍", coverUrl: "", source: "user", sourceName: "赵老师", sourceAvatar: undefined, learnerCount: 4560, categoryKey: "practical", subCategoryKey: "grammar_vocab", createdAt: daysAgo(60), usageCount: 8900 },

  // ===== 实用英语 - 日常口语 =====
  { id: "pe_do_01", title: "日常英语口语 - 购物与点餐", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5670, categoryKey: "practical", subCategoryKey: "daily_oral", createdAt: daysAgo(150), usageCount: 13400 },
  { id: "pe_do_02", title: "日常英语口语 - 社交与闲聊", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4890, categoryKey: "practical", subCategoryKey: "daily_oral", createdAt: daysAgo(120), usageCount: 11200 },

  // ===== 实用英语 - 旅游英语 =====
  { id: "pe_te_01", title: "旅游英语 - 机场与酒店必备", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 6230, categoryKey: "practical", subCategoryKey: "travel_english", createdAt: daysAgo(140), usageCount: 14500 },
  { id: "pe_te_02", title: "旅游英语 - 问路与交通", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 4120, categoryKey: "practical", subCategoryKey: "travel_english", createdAt: daysAgo(100), usageCount: 9800 },

  // ===== 实用英语 - 商务职场 =====
  { id: "pe_bc_01", title: "商务英语 - 邮件写作精要", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 5340, categoryKey: "practical", subCategoryKey: "business_career", createdAt: daysAgo(160), usageCount: 12300 },
  { id: "pe_bc_02", title: "商务英语 - 会议与演示", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 3890, categoryKey: "practical", subCategoryKey: "business_career", createdAt: daysAgo(130), usageCount: 8700 },

  // ===== 实用英语 - 电影与故事 =====
  { id: "pe_ms_01", title: "经典电影台词 - 阿甘正传", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 7890, categoryKey: "practical", subCategoryKey: "movies_stories", createdAt: daysAgo(190), usageCount: 17800 },
  { id: "pe_ms_02", title: "英文短篇故事 - 小王子精选", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: officialAvatar, learnerCount: 6120, categoryKey: "practical", subCategoryKey: "movies_stories", createdAt: daysAgo(170), usageCount: 14500 },
]
