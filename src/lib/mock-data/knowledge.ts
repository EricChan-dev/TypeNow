import type { SentenceKnowledge } from "@/types/course"

const fallback: Record<string, SentenceKnowledge> = {
  s_001: {
    chineseExplanation: `这句话的意思是"我在公园里"，用来告诉别人你当前所在的位置。`,
    englishExplanation: `This sentence means you are currently located at the park. It tells someone about your location.`,
    wordAnnotations: `I：我，第一人称代词
am：是，be动词第一人称单数形式
at：在（某地），介词，表示位置
the：定冠词，特指
park：公园，名词`,
    grammarAnalysis: `主系表结构：主语 I + 系动词 am + 表语 at the park（介词短语作表语）。英语中最基础的句型之一，用于表达状态或位置。`,
    cultureNotes: `在英式英语中"at the park"表示在公园这个地点；美式英语也可用"in the park"强调在公园内部。日常交流中，这句话常用于家人之间告知位置。`,
    usageScenarios: `用于告诉别人你的位置，常见于电话对话、短信或面对面交流。例如：妈妈打电话问你在哪里，就可以回答"I am at the park."`,
    relatedExamples: `She is at school.（她在学校）
We are at home.（我们在家）
He is at the office.（他在办公室）`,
  },
  s_002: {
    chineseExplanation: `这句话的意思是"这只狗很大"，用来描述一个动物的体型特征。`,
    englishExplanation: `This sentence describes the size of a dog. The speaker is saying the dog is large in size.`,
    wordAnnotations: `The：定冠词，特指某只狗
dog：狗，名词
is：是，be动词第三人称单数
big：大的，形容词`,
    grammarAnalysis: `主系表结构：主语 The dog + 系动词 is + 表语 big（形容词作表语）。形容词在系动词后直接作表语，不需要变化。`,
    cultureNotes: `英语中用"big"描述体型，"large"更正式。描述宠物时常用"big"显得亲切。西方文化中直接说某物"big"是中性描述，不带有负面含义。`,
    usageScenarios: `描述动物、物体或人的大小时使用。例如看到一只大狗时感叹，或描述某物的尺寸。`,
    relatedExamples: `The cat is small.（这只猫很小）
The house is big.（这栋房子很大）
This apple is red.（这个苹果是红的）`,
  },
  s_011: {
    chineseExplanation: `这是老师上课时的开场白，意思是"同学们，早上好"，用来开始一天的课堂。`,
    englishExplanation: `A common classroom greeting. The teacher is saying hello to all students at the start of class.`,
    wordAnnotations: `Good：好的，形容词
morning：早上，名词
boys：男孩们，名词复数
and：和，连词
girls：女孩们，名词复数`,
    grammarAnalysis: `省略句结构。完整句子可以是"(I wish you a) good morning, boys and girls." 日常口语中省略了主语和谓语部分，直接用问候语开头。`,
    cultureNotes: `"boys and girls"是英语课堂中老师对学生的亲切称呼，从幼儿园到小学阶段常用。初高中后更常用"everyone"或"class"。英式课堂可能用"children"。`,
    usageScenarios: `课堂开始时的问候语。老师走进教室后使用，学生通常回应"Good morning, teacher!"或"Good morning, Mr./Ms. X!"`,
    relatedExamples: `Good afternoon, everyone.（大家下午好）
Hello, class!（同学们好！）
Morning, kids!（孩子们，早上好！）`,
  },
}

export function getMockKnowledge(sentenceId: string): SentenceKnowledge {
  if (fallback[sentenceId]) return fallback[sentenceId]
  return {
    chineseExplanation: `这是一句英语日常用语。`,
    englishExplanation: `This is a common English expression.`,
    wordAnnotations: `常见单词和短语组合，请参考课程内容。`,
    grammarAnalysis: `请参考课程提供的语法讲解。`,
    cultureNotes: `在英语日常交流中常用。`,
    usageScenarios: `适用于日常生活和一般交流场景。`,
    relatedExamples: `更多例句请等待 AI 分析。`,
  }
}
