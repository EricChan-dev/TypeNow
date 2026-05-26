import type { Course, Lesson } from "@/types/course"

const now = new Date()

function daysAgo(d: number) {
  const date = new Date(now)
  date.setDate(date.getDate() - d)
  return date.toISOString()
}

// ===== Descriptions for each course =====
const descriptions: Record<string, string> = {
  gr_ot_01: "牛津阅读树 Level 1 入门课程，通过 At the Park 趣味故事学习基础词汇与简单句型。",
  gr_ot_02: "牛津阅读树 Level 2 进阶，The Lost Teddy 故事帮助孩子建立基础阅读能力。",
  gr_rz_01: "RAZ Level A 分级阅读，以 My Dog 为主题学习动物词汇和简单描述句型。",
  gr_rz_02: "RAZ Level B 分级阅读，在 At the Zoo 场景中扩展词汇量和阅读能力。",
  gr_hn_01: "海尼曼 GK 级别，Going Sledding 主题帮助零基础幼儿建立英语语感。",
  gr_hn_02: "海尼曼 G1 级别进阶课程，The New Puppy 故事提升简单阅读理解能力。",
  gr_bc_01: "大猫分级阅读 Pink A 入门，In the Garden 主题培养早期阅读兴趣。",
  gr_bc_02: "大猫分级阅读 Red A 级别，The Magic Show 故事激发想象力和阅读热情。",
  gr_rr_01: "红火箭 Early Level 1，Fruit Salad 主题结合生活场景学习基础英语。",
  gr_rr_02: "红火箭 Early Level 2 进阶，My Family 主题系统建立词汇基础和句型。",
  gr_lg_01: "Let's Go 第一册入门课程，Hello, I'm Tom 零基础轻松开启英语学习。",
  gr_lg_02: "Let's Go 第二册进阶，What's This? 主题扩展日常词汇和问答句型。",
  gr_ob_01: "牛津书虫经典名著简写版，福尔摩斯探案故事适合初中级英语学习者。",
  gr_ob_02: "牛津书虫名著系列，傲慢与偏见简写版帮助学习者通过经典小说提升英语。",
  ss_g1_01: "一年级英语上册同步课程，Unit 1 School 主题紧扣教材重点句型与词汇。",
  ss_g2_01: "二年级英语上册同步，Unit 2 My Family 主题巩固家庭成员词汇与表达。",
  ss_g3_01: "三年级英语上册同步，Unit 3 Animals 主题拓展动物词汇与简单对话。",
  ss_g4_01: "四年级英语上册同步，Unit 4 Weather 主题学习天气描述与季节表达。",
  ss_g5_01: "五年级英语上册同步，Unit 5 Food 主题深入学习饮食相关词汇与句型。",
  ss_g6_01: "六年级英语上册同步，Unit 6 Hobbies 主题培养话题表达和段落写作。",
  ss_g7_01: "七年级英语上册同步，Unit 7 School Life 强化初中阶段重点语法和阅读。",
  ss_g8_01: "八年级英语上册同步，Unit 8 Travel 主题训练复杂句型和阅读理解。",
  ss_g9_01: "九年级中考复习课程，语法专题全面梳理中考核心语法点和解题技巧。",
  ss_hs_01: "高中英语必修一同步，Teenage Life 主题深入训练高中核心词汇与阅读。",
  ss_hs_02: "高中英语必修二同步，History 主题聚焦历史文化话题与高级句型训练。",
  ss_vo_01: "中职英语基础模块，紧扣职业场景，学习实用职场英语基础表达。",
  ep_zk_01: "中考英语完形填空专项训练，系统讲解解题思路和高频考点突破。",
  ep_zk_02: "中考英语阅读理解高频词汇，科学记忆法快速掌握必考词汇。",
  ep_gk_01: "高考英语写作高分模板，从审题到成文系统训练高分写作技巧。",
  ep_gk_02: "高考英语长难句分析，拆解复杂句式提升阅读理解和翻译能力。",
  ep_de_01: "学位英语核心词汇 3000，科学分组记忆方法高效攻克词汇难关。",
  ep_zsb_01: "专升本英语翻译专项突破，针对翻译题型系统训练中英互译能力。",
  ep_cet_01: "大学英语四级听力词汇通关，高频听力场景词汇+真题训练双管齐下。",
  ep_cet_02: "大学英语六级翻译写作精练，针对六级难度系统提升写作和翻译水平。",
  ep_pg_01: "考研英语阅读真题长难句，逐句精析历年真题长难句结构和考点。",
  ep_tem_01: "专四语法与词汇 1000 题，覆盖专四核心考点，系统巩固语法和词汇。",
  ep_ielts_01: "雅思口语话题词汇库，按话题分类整理高分词汇和地道表达。",
  ep_ielts_02: "托福写作常用表达 200 句，掌握高分句型和学术写作必备表达。",
  ep_ket_01: "KET 核心词汇 A-Z，按字母顺序系统学习剑桥 KET 考试必备词汇。",
  ep_pet_01: "PET 阅读写作冲刺，针对 PET 阅读和写作题型进行考前强化训练。",
  ep_fce_01: "FCE 语法与词汇进阶，系统学习剑桥 FCE 级别的高级语法和词汇。",
  ep_pte_01: "PTE 听说读写全项训练，覆盖 PTE 四大模块的题型技巧和模拟训练。",
  ep_gre_01: "GRE 高频词汇 3000，词根词缀+语境记忆法高效攻克 GRE 词汇。",
  ep_toeic_01: "托业商务词汇与阅读，系统学习托业核心商务词汇和阅读题型技巧。",
  pe_ls_01: "英语听力入门课程，日常对话 100 篇逐步培养听力理解能力和口语表达。",
  pe_ls_02: "美式发音速成课程，从音标到连读系统训练地道美式英语发音技巧。",
  pe_ct_01: "新概念英语第一册课文精讲，零基础系统学习英语基础语法和句型。",
  pe_ct_02: "新概念英语第二册句型训练，通过经典课文巩固中级语法和写作能力。",
  pe_gv_01: "英语语法大全时态专项，系统梳理 16 种时态的用法和区别。",
  pe_gv_02: "词根词缀记忆法课程，通过科学方法让词汇量翻倍增长。",
  pe_do_01: "日常英语口语购物与点餐，真实场景模拟训练实用口语表达能力。",
  pe_do_02: "日常英语口语社交与闲聊，掌握日常社交场景必备的口语表达。",
  pe_te_01: "旅游英语机场与酒店必备，覆盖出国旅游最常用场景的实用英语。",
  pe_te_02: "旅游英语问路与交通，掌握在国外出行必备的英语问路和交通表达。",
  pe_bc_01: "商务英语邮件写作精要，学习专业商务邮件格式、礼仪和常用表达。",
  pe_bc_02: "商务英语会议与演示，提升英文会议发言和商务演示的表达能力。",
  pe_ms_01: "经典电影台词阿甘正传，通过经典电影学习地道英语表达和文化背景。",
  pe_ms_02: "英文短篇故事小王子精选，通过经典文学作品提升阅读理解和语言素养。",
}

export const mockCourses: Course[] = [
  // ===== 分级阅读 - 牛津树 =====
  { id: "gr_ot_01", title: "牛津阅读树 Level 1 - At the Park", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2340, categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree", createdAt: daysAgo(120), usageCount: 4520, isPublished: 1, description: descriptions.gr_ot_01 },
  { id: "gr_ot_02", title: "牛津阅读树 Level 2 - The Lost Teddy", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1890, categoryKey: "graded_reading", subCategoryKey: "oxford_reading_tree", createdAt: daysAgo(90), usageCount: 3210, isPublished: 1, description: descriptions.gr_ot_02 },
  // ===== 分级阅读 - RAZ =====
  { id: "gr_rz_01", title: "RAZ Level A - My Dog", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 3120, categoryKey: "graded_reading", subCategoryKey: "raz", createdAt: daysAgo(150), usageCount: 6780, isPublished: 1, description: descriptions.gr_rz_01 },
  { id: "gr_rz_02", title: "RAZ Level B - At the Zoo", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2670, categoryKey: "graded_reading", subCategoryKey: "raz", createdAt: daysAgo(100), usageCount: 5430, isPublished: 1, description: descriptions.gr_rz_02 },
  // ===== 分级阅读 - 海尼曼 =====
  { id: "gr_hn_01", title: "海尼曼 GK - Going Sledding", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1560, categoryKey: "graded_reading", subCategoryKey: "heinemann", createdAt: daysAgo(80), usageCount: 2890, isPublished: 1, description: descriptions.gr_hn_01 },
  { id: "gr_hn_02", title: "海尼曼 G1 - The New Puppy", coverUrl: "", source: "user", sourceName: "王老师", sourceAvatar: undefined, learnerCount: 890, categoryKey: "graded_reading", subCategoryKey: "heinemann", createdAt: daysAgo(45), usageCount: 1340, isPublished: 1, description: descriptions.gr_hn_02 },
  // ===== 分级阅读 - 大猫分级阅读 =====
  { id: "gr_bc_01", title: "大猫分级阅读 Pink A - In the Garden", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1230, categoryKey: "graded_reading", subCategoryKey: "big_cat", createdAt: daysAgo(70), usageCount: 2100, isPublished: 1, description: descriptions.gr_bc_01 },
  { id: "gr_bc_02", title: "大猫分级阅读 Red A - The Magic Show", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 980, categoryKey: "graded_reading", subCategoryKey: "big_cat", createdAt: daysAgo(55), usageCount: 1670, isPublished: 1, description: descriptions.gr_bc_02 },
  // ===== 分级阅读 - 红火箭 =====
  { id: "gr_rr_01", title: "红火箭 Early Level 1 - Fruit Salad", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1450, categoryKey: "graded_reading", subCategoryKey: "red_rocket", createdAt: daysAgo(110), usageCount: 2980, isPublished: 1, description: descriptions.gr_rr_01 },
  { id: "gr_rr_02", title: "红火箭 Early Level 2 - My Family", coverUrl: "", source: "user", sourceName: "李老师", sourceAvatar: undefined, learnerCount: 720, categoryKey: "graded_reading", subCategoryKey: "red_rocket", createdAt: daysAgo(30), usageCount: 980, isPublished: 1, description: descriptions.gr_rr_02 },
  // ===== 分级阅读 - Let's Go =====
  { id: "gr_lg_01", title: "Let's Go 1 - Hello, I'm Tom", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2100, categoryKey: "graded_reading", subCategoryKey: "lets_go", createdAt: daysAgo(130), usageCount: 4560, isPublished: 1, description: descriptions.gr_lg_01 },
  { id: "gr_lg_02", title: "Let's Go 2 - What's This?", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1780, categoryKey: "graded_reading", subCategoryKey: "lets_go", createdAt: daysAgo(95), usageCount: 3120, isPublished: 1, description: descriptions.gr_lg_02 },
  // ===== 分级阅读 - 牛津书虫 =====
  { id: "gr_ob_01", title: "牛津书虫 - 福尔摩斯探案", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 3450, categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm", createdAt: daysAgo(200), usageCount: 8900, isPublished: 1, description: descriptions.gr_ob_01 },
  { id: "gr_ob_02", title: "牛津书虫 - 傲慢与偏见", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2890, categoryKey: "graded_reading", subCategoryKey: "oxford_bookworm", createdAt: daysAgo(180), usageCount: 7200, isPublished: 1, description: descriptions.gr_ob_02 },
  // ===== 中小学同步 =====
  { id: "ss_g1_01", title: "一年级英语上册 - Unit 1 School", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5670, categoryKey: "school_sync", subCategoryKey: "grade_1", createdAt: daysAgo(300), usageCount: 12340, isPublished: 1, description: descriptions.ss_g1_01 },
  { id: "ss_g2_01", title: "二年级英语上册 - Unit 2 My Family", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4890, categoryKey: "school_sync", subCategoryKey: "grade_2", createdAt: daysAgo(280), usageCount: 10200, isPublished: 1, description: descriptions.ss_g2_01 },
  { id: "ss_g3_01", title: "三年级英语上册 - Unit 3 Animals", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "school_sync", subCategoryKey: "grade_3", createdAt: daysAgo(260), usageCount: 15670, isPublished: 1, description: descriptions.ss_g3_01 },
  { id: "ss_g4_01", title: "四年级英语上册 - Unit 4 Weather", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5230, categoryKey: "school_sync", subCategoryKey: "grade_4", createdAt: daysAgo(240), usageCount: 11200, isPublished: 1, description: descriptions.ss_g4_01 },
  { id: "ss_g5_01", title: "五年级英语上册 - Unit 5 Food", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4560, categoryKey: "school_sync", subCategoryKey: "grade_5", createdAt: daysAgo(220), usageCount: 9800, isPublished: 1, description: descriptions.ss_g5_01 },
  { id: "ss_g6_01", title: "六年级英语上册 - Unit 6 Hobbies", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4120, categoryKey: "school_sync", subCategoryKey: "grade_6", createdAt: daysAgo(200), usageCount: 8700, isPublished: 1, description: descriptions.ss_g6_01 },
  { id: "ss_g7_01", title: "七年级英语上册 - Unit 7 School Life", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5430, categoryKey: "school_sync", subCategoryKey: "grade_7", createdAt: daysAgo(180), usageCount: 13400, isPublished: 1, description: descriptions.ss_g7_01 },
  { id: "ss_g8_01", title: "八年级英语上册 - Unit 8 Travel", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4780, categoryKey: "school_sync", subCategoryKey: "grade_8", createdAt: daysAgo(160), usageCount: 10800, isPublished: 1, description: descriptions.ss_g8_01 },
  { id: "ss_g9_01", title: "九年级中考复习 - 语法专题", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 7890, categoryKey: "school_sync", subCategoryKey: "grade_9", createdAt: daysAgo(140), usageCount: 18900, isPublished: 1, description: descriptions.ss_g9_01 },
  { id: "ss_hs_01", title: "高中英语必修一 - Unit 1 Teenage Life", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 6230, categoryKey: "school_sync", subCategoryKey: "high_school", createdAt: daysAgo(120), usageCount: 14500, isPublished: 1, description: descriptions.ss_hs_01 },
  { id: "ss_hs_02", title: "高中英语必修二 - Unit 2 History", coverUrl: "", source: "user", sourceName: "张老师", sourceAvatar: undefined, learnerCount: 3120, categoryKey: "school_sync", subCategoryKey: "high_school", createdAt: daysAgo(60), usageCount: 5600, isPublished: 1, description: descriptions.ss_hs_02 },
  { id: "ss_vo_01", title: "中职英语 - 基础模块 1", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1890, categoryKey: "school_sync", subCategoryKey: "vocational", createdAt: daysAgo(90), usageCount: 3400, isPublished: 1, description: descriptions.ss_vo_01 },
  // ===== 应试考试 =====
  { id: "ep_zk_01", title: "中考英语 - 完形填空专项训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 10230, categoryKey: "exam_prep", subCategoryKey: "zhongkao", createdAt: daysAgo(250), usageCount: 28900, isPublished: 1, description: descriptions.ep_zk_01 },
  { id: "ep_zk_02", title: "中考英语 - 阅读理解高频词汇", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 8760, categoryKey: "exam_prep", subCategoryKey: "zhongkao", createdAt: daysAgo(200), usageCount: 21300, isPublished: 1, description: descriptions.ep_zk_02 },
  { id: "ep_gk_01", title: "高考英语 - 写作高分模板", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 13450, categoryKey: "exam_prep", subCategoryKey: "gaokao", createdAt: daysAgo(300), usageCount: 35600, isPublished: 1, description: descriptions.ep_gk_01 },
  { id: "ep_gk_02", title: "高考英语 - 长难句分析", coverUrl: "", source: "user", sourceName: "刘老师", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "exam_prep", subCategoryKey: "gaokao", createdAt: daysAgo(50), usageCount: 12300, isPublished: 1, description: descriptions.ep_gk_02 },
  { id: "ep_de_01", title: "学位英语 - 核心词汇 3000", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 3450, categoryKey: "exam_prep", subCategoryKey: "degree_english", createdAt: daysAgo(150), usageCount: 7800, isPublished: 1, description: descriptions.ep_de_01 },
  { id: "ep_zsb_01", title: "专升本英语 - 翻译专项突破", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4560, categoryKey: "exam_prep", subCategoryKey: "zhuan_sheng_ben", createdAt: daysAgo(130), usageCount: 10200, isPublished: 1, description: descriptions.ep_zsb_01 },
  { id: "ep_cet_01", title: "大学英语四级 - 听力词汇通关", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 15670, categoryKey: "exam_prep", subCategoryKey: "cet_4_6", createdAt: daysAgo(350), usageCount: 45600, isPublished: 1, description: descriptions.ep_cet_01 },
  { id: "ep_cet_02", title: "大学英语六级 - 翻译写作精练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 11230, categoryKey: "exam_prep", subCategoryKey: "cet_4_6", createdAt: daysAgo(300), usageCount: 32400, isPublished: 1, description: descriptions.ep_cet_02 },
  { id: "ep_pg_01", title: "考研英语 - 阅读真题长难句", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 18900, categoryKey: "exam_prep", subCategoryKey: "postgraduate", createdAt: daysAgo(280), usageCount: 52300, isPublished: 1, description: descriptions.ep_pg_01 },
  { id: "ep_tem_01", title: "专四 - 语法与词汇 1000 题", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5670, categoryKey: "exam_prep", subCategoryKey: "tem_4_8", createdAt: daysAgo(170), usageCount: 13400, isPublished: 1, description: descriptions.ep_tem_01 },
  { id: "ep_ielts_01", title: "雅思 - 口语话题词汇库", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 12340, categoryKey: "exam_prep", subCategoryKey: "ielts_toefl", createdAt: daysAgo(220), usageCount: 31200, isPublished: 1, description: descriptions.ep_ielts_01 },
  { id: "ep_ielts_02", title: "托福 - 写作常用表达 200 句", coverUrl: "", source: "user", sourceName: "陈老师", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "exam_prep", subCategoryKey: "ielts_toefl", createdAt: daysAgo(40), usageCount: 9800, isPublished: 1, description: descriptions.ep_ielts_02 },
  { id: "ep_ket_01", title: "KET - 核心词汇 A-Z", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2340, categoryKey: "exam_prep", subCategoryKey: "ket", createdAt: daysAgo(100), usageCount: 5600, isPublished: 1, description: descriptions.ep_ket_01 },
  { id: "ep_pet_01", title: "PET - 阅读写作冲刺", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1890, categoryKey: "exam_prep", subCategoryKey: "pet", createdAt: daysAgo(85), usageCount: 4300, isPublished: 1, description: descriptions.ep_pet_01 },
  { id: "ep_fce_01", title: "FCE - 语法与词汇进阶", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 1200, categoryKey: "exam_prep", subCategoryKey: "fce", createdAt: daysAgo(70), usageCount: 2800, isPublished: 1, description: descriptions.ep_fce_01 },
  { id: "ep_pte_01", title: "PTE - 听说读写全项训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 980, categoryKey: "exam_prep", subCategoryKey: "pte", createdAt: daysAgo(50), usageCount: 2100, isPublished: 1, description: descriptions.ep_pte_01 },
  { id: "ep_gre_01", title: "GRE - 高频词汇 3000", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4560, categoryKey: "exam_prep", subCategoryKey: "gre", createdAt: daysAgo(160), usageCount: 12300, isPublished: 1, description: descriptions.ep_gre_01 },
  { id: "ep_toeic_01", title: "托业 - 商务词汇与阅读", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 2340, categoryKey: "exam_prep", subCategoryKey: "toeic", createdAt: daysAgo(110), usageCount: 5600, isPublished: 1, description: descriptions.ep_toeic_01 },
  // ===== 实用英语 - 听力口语 =====
  { id: "pe_ls_01", title: "英语听力入门 - 日常对话 100 篇", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 7890, categoryKey: "practical", subCategoryKey: "listening_speaking", createdAt: daysAgo(200), usageCount: 18900, isPublished: 1, description: descriptions.pe_ls_01 },
  { id: "pe_ls_02", title: "美式发音速成 - 音标与连读", coverUrl: "", source: "user", sourceName: "David老师", sourceAvatar: undefined, learnerCount: 3450, categoryKey: "practical", subCategoryKey: "listening_speaking", createdAt: daysAgo(30), usageCount: 6700, isPublished: 1, description: descriptions.pe_ls_02 },
  // ===== 实用英语 - 经典教材 =====
  { id: "pe_ct_01", title: "新概念英语第一册 - 课文精讲", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 12340, categoryKey: "practical", subCategoryKey: "classic_textbooks", createdAt: daysAgo(400), usageCount: 34500, isPublished: 1, description: descriptions.pe_ct_01 },
  { id: "pe_ct_02", title: "新概念英语第二册 - 句型训练", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 10230, categoryKey: "practical", subCategoryKey: "classic_textbooks", createdAt: daysAgo(350), usageCount: 28900, isPublished: 1, description: descriptions.pe_ct_02 },
  // ===== 实用英语 - 语法词汇 =====
  { id: "pe_gv_01", title: "英语语法大全 - 时态专项练习", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 6780, categoryKey: "practical", subCategoryKey: "grammar_vocab", createdAt: daysAgo(180), usageCount: 15600, isPublished: 1, description: descriptions.pe_gv_01 },
  { id: "pe_gv_02", title: "词根词缀记忆法 - 词汇量翻倍", coverUrl: "", source: "user", sourceName: "赵老师", sourceAvatar: undefined, learnerCount: 4560, categoryKey: "practical", subCategoryKey: "grammar_vocab", createdAt: daysAgo(60), usageCount: 8900, isPublished: 1, description: descriptions.pe_gv_02 },
  // ===== 实用英语 - 日常口语 =====
  { id: "pe_do_01", title: "日常英语口语 - 购物与点餐", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5670, categoryKey: "practical", subCategoryKey: "daily_oral", createdAt: daysAgo(150), usageCount: 13400, isPublished: 1, description: descriptions.pe_do_01 },
  { id: "pe_do_02", title: "日常英语口语 - 社交与闲聊", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4890, categoryKey: "practical", subCategoryKey: "daily_oral", createdAt: daysAgo(120), usageCount: 11200, isPublished: 1, description: descriptions.pe_do_02 },
  // ===== 实用英语 - 旅游英语 =====
  { id: "pe_te_01", title: "旅游英语 - 机场与酒店必备", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 6230, categoryKey: "practical", subCategoryKey: "travel_english", createdAt: daysAgo(140), usageCount: 14500, isPublished: 1, description: descriptions.pe_te_01 },
  { id: "pe_te_02", title: "旅游英语 - 问路与交通", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 4120, categoryKey: "practical", subCategoryKey: "travel_english", createdAt: daysAgo(100), usageCount: 9800, isPublished: 1, description: descriptions.pe_te_02 },
  // ===== 实用英语 - 商务职场 =====
  { id: "pe_bc_01", title: "商务英语 - 邮件写作精要", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 5340, categoryKey: "practical", subCategoryKey: "business_career", createdAt: daysAgo(160), usageCount: 12300, isPublished: 1, description: descriptions.pe_bc_01 },
  { id: "pe_bc_02", title: "商务英语 - 会议与演示", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 3890, categoryKey: "practical", subCategoryKey: "business_career", createdAt: daysAgo(130), usageCount: 8700, isPublished: 1, description: descriptions.pe_bc_02 },
  // ===== 实用英语 - 电影与故事 =====
  { id: "pe_ms_01", title: "经典电影台词 - 阿甘正传", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 7890, categoryKey: "practical", subCategoryKey: "movies_stories", createdAt: daysAgo(190), usageCount: 17800, isPublished: 1, description: descriptions.pe_ms_01 },
  { id: "pe_ms_02", title: "英文短篇故事 - 小王子精选", coverUrl: "", source: "official", sourceName: "TypeNow官方", sourceAvatar: undefined, learnerCount: 6120, categoryKey: "practical", subCategoryKey: "movies_stories", createdAt: daysAgo(170), usageCount: 14500, isPublished: 1, description: descriptions.pe_ms_02 },
]

// ===== Generated Lessons =====
const lessonSummaries = [
  "学习本课核心词汇和重点句型，通过例句和练习巩固知识。",
  "掌握本课的语法要点，结合上下文理解语法规则的实际应用。",
  "通过对话练习提升口语表达能力，模仿标准发音和语调。",
  "阅读本课短文，训练阅读理解能力，学习文章结构和逻辑。",
  "听力训练环节，通过音频材料提升听力理解水平。",
  "写作练习，运用本课学到的词汇和句型完成写作任务。",
  "复习巩固前几课的知识点，通过综合练习查漏补缺。",
  "学习本课主题相关的文化背景知识，拓展语言学习的深度。",
  "重点词汇和短语的扩展学习，丰富语言表达的多样性。",
  "场景模拟训练，在真实语境中灵活运用所学内容。",
  "常见错误分析和纠正，避免典型语法和用词错误。",
  "通过趣味游戏和互动练习，在轻松氛围中巩固学习成果。",
]

function generateLessons(courseId: string, count: number): Lesson[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${courseId}_lesson_${String(i + 1).padStart(2, "0")}`,
    courseId,
    title: `第 ${i + 1} 课`,
    summary: lessonSummaries[i % lessonSummaries.length],
    order: i + 1,
  }))
}

// Key courses get more lessons, others get fewer
const keyCourseIds = [
  "gr_ot_01", "gr_rz_01", "gr_ob_01", "ss_g1_01", "ss_g7_01",
  "ss_g9_01", "ep_zk_01", "ep_gk_01", "ep_cet_01", "ep_ielts_01",
  "pe_ct_01", "pe_do_01", "pe_bc_01", "pe_ms_01",
]

export const mockLessons: Lesson[] = mockCourses.flatMap((course) =>
  generateLessons(course.id, keyCourseIds.includes(course.id) ? 15 : 6)
)
