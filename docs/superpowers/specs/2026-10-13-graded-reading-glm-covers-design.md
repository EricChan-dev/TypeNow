# 分级阅读封面重做 · 设计文档

- 日期：2026-10-13
- 状态：已批准
- 范围：`graded_reading` 分类下 49 门在架课程的封面图
- 前置：school_sync 194 门 glm-image 管线（已完成）

---

## 1. 背景与问题

### 1.1 现状

`graded_reading` 共 49 门在架课程，分布在 8 个槽位：

| 槽位 | 课程数 |
|------|--------|
| oxford_reading_tree | 7 |
| lets_go | 7 |
| raz | 7 |
| heinemann | 7 |
| big_cat | 6 |
| oxford_bookworm | 6 |
| red_rocket | 5 |
| _(NULL)_ | 4 |

封面来源混杂，与 `school_sync`（194 门，已全部用 glm-image 重做）风格不一致：

| 来源 | 张数 | 模型 | 尺寸 | 有标题字 | 生成日期 |
|------|------|------|------|----------|----------|
| 主题槽位图 `graded_reading__*__v*.webp` | 24 | wan2.2-t2i-flash | 1440×960 | ❌ | 2026-09-29 |
| 逐课图 `<courseId>.webp` | 21 | cogview-3-flash | 1248×832 | ❌ | 2026-09-30 |
| 无封面（渐变色卡兜底） | 4 | — | — | — | — |

### 1.2 问题

1. **风格不一致**：school_sync 已全面切换到「扁平明亮插画 + 烤中文标题」，graded_reading 仍是旧的水彩/扁平/3D 混合风格，且无标题字。
2. **尺寸不统一**：21 张 cogview 图是 1248×832（3:2），与 school_sync 的 1440×960 不同。
3. **共用图**：24 门课共用 8 个槽位的主题图（每槽位 3 张），同一槽位内相邻课程封面重复。
4. **4 门课无封面**：`Let's Go 2`、`RAZ 科学主题读物`、`红火箭：早期阅读系列`、`红火箭：非虚构科学A辑` 退回渐变色卡。

### 1.3 目标

- 49 门课**每门一张专属封面**，不共用。
- 风格与 school_sync 10-11 日版本**完全一致**：扁平矢量插画 + 高饱和互补色 + 烤中文标题。
- 标题映射：**主标题 = 系列名**（牛津树/RAZ/大猫/海尼曼/红火箭/Let's Go/牛津书虫），**副标题 = 级别/主题**。
- 尺寸 1440×960（3:2），WebP q80 落盘。
- 写回 `courses.cover_url`，写库前 mysqldump 备份。

---

## 2. 技术方案

### 2.1 管线复用

复用 `/tmp/all194` 已验证的 school_sync 管线，适配 graded_reading：

| 步骤 | 工具 | 说明 |
|------|------|------|
| 1. 拉取课程 | MySQL | `SELECT id, title, sub_category_key FROM courses WHERE is_published=1 AND category_key='graded_reading'` |
| 2. 标题蒸馏 | DeepSeek-flash | 产出 `main`（系列名）+ `sub`（级别/主题）+ `scene`（场景描述，30-60字） |
| 3. 出图 | glm-image | `POST https://open.bigmodel.cn/api/paas/v4/images/generations`，`model: "glm-image"`，`size: "1440x960"`，`watermark_enabled: false` |
| 4. OCR 校验 | /tmp/ocrtool/ocr | Apple Vision OCR，校验标题字正确性，失败重跑（≤3轮） |
| 5. 转码落盘 | sharp | PNG → WebP q80 → `public/images/courses/<courseId>.webp` |
| 6. 写库 | mysql2 | mysqldump 备份 → 事务 UPDATE cover_url |

### 2.2 风格提示词（与 school_sync 完全一致）

```
儿童教育课程封面。扁平矢量插画风格，几何化圆润造型，平涂上色，边缘干净利落。
明亮鲜艳的高饱和度配色，互补色碰撞，画面饱满铺满整幅。
背景被具体的场景元素填满：楼房、树木、云朵、花草、栏杆、小物件、装饰花纹铺满画面每个角落，
几乎没有大片纯色或白色空白。
```

### 2.3 标题版式随机池

按 `courseId` 哈希稳定选取（与 school_sync 相同）：

- **位置池（5 选 1）**：贴顶单行 / 上部单行 / 中部偏上 / 双行错落 / 上部双行
- **配色池（5 选 1）**：白字深蓝描边 / 亮黄浅蓝双行 / 深蓝平涂 / 亮黄深绿描边 / 深蓝字白描边
- **倾斜**：12% 概率加 ~6° 轻微倾斜

### 2.4 标题映射规则

| 课程原标题 | main | sub |
|-----------|------|-----|
| 牛津树：魔法钥匙大冒险 | 牛津树 | 魔法钥匙大冒险 |
| RAZ Levels A-C：萌芽读者入门 | RAZ | A-C 萌芽读者 |
| 大猫分级：Band 1-2 自然拼读入门 | 大猫分级 | Band 1-2 自然拼读 |
| 海尼曼：日常事物 | 海尼曼 | 日常事物 |
| 红火箭：非虚构社会B辑 | 红火箭 | 非虚构社会B辑 |
| Let's Go 3：学校与课外活动 | Let's Go | 3 学校与课外活动 |
| 牛津书虫 Level 3：中级文学 | 牛津书虫 | Level 3 中级文学 |
| 分级阅读L0 | 分级阅读 | L0 |
| 【RE F级】 | RE | F级 |
| 【粒粒】Guided Reading 1 | 粒粒 | Guided Reading 1 |

**约束**：
- main ≤ 7 个汉字（或等长英文）
- sub ≤ 14 个汉字
- 不出现「版版」「年纪」等错字
- sub 不重复 main 内容

### 2.5 场景描述约束

与 school_sync 相同：
- 30-60 字中文
- 必须包含人物动作
- 与课程主题/系列相关
- 绝对不能出现「书上的字」「黑板上的字」「写着字」
- 书本/黑板/白板/屏幕必须明确说明是空白的
- 不描述任何文字、字母、数字

### 2.6 OCR 校验规则

与 school_sync 相同：
1. 标题文字必须出现（main + sub 拼接后归一化匹配）
2. 标题之外不得再有 `h≥0.10` 且 `≥2字` 的文本行（单字噪声忽略）
3. 第一遍不过 → 放大 2x 复判 → 仍不过 → 3x 再试
4. 最多 3 轮重生成

---

## 3. 成本估算

| 项 | 数量 | 单价 | 小计 |
|----|------|------|------|
| glm-image 出图 | 49 张（含重试 ~60 张） | 0.1 元/张 | ~6 元 |
| DeepSeek 标题蒸馏 | 49 条 | ~0.001 元/条 | ~0.05 元 |
| **总计** | | | **~6 元** |

---

## 4. 脚本位置

新建 `scripts/gen-graded-covers.ts`（TypeScript，与仓库其他脚本一致）。

**不新建 Python 脚本**：仓库约定是 TypeScript + tsx，且 `/tmp/all194` 的 Python 脚本是临时产物，不应进仓库。OCR 工具 `/tmp/ocrtool/ocr` 通过 `child_process.execFileSync` 调用。

---

## 5. 数据流

```
MySQL (49 courses)
    ↓
DeepSeek (标题蒸馏: main/sub/scene)
    ↓
glm-image (出图: 1440×960 PNG)
    ↓
/tmp/ocrtool/ocr (标题校验)
    ↓ [失败 → 重跑 ≤3轮]
sharp (PNG → WebP q80)
    ↓
public/images/courses/<courseId>.webp
    ↓
mysqldump 备份 → UPDATE courses.cover_url
```

---

## 6. 验收标准

- [ ] 49 门课全部有专属封面（`cover_url = /images/courses/<courseId>.webp`）
- [ ] 无两门课共用同一张图
- [ ] 所有封面尺寸 1440×960，WebP 格式
- [ ] OCR 校验：标题字正确率 ≥ 95%（允许个别生僻字误判）
- [ ] 风格与 school_sync 视觉一致（扁平明亮 + 烤标题）
- [ ] 写库前有 mysqldump 备份
- [ ] 无 404（所有 cover_url 指向的文件真实存在）

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| glm-image 额度不足 | 先跑 5 张冒烟测试，确认额度后再全量 |
| 标题 OCR 误判 | 放大 2x/3x 复判（school_sync 已验证有效） |
| 内容审核拒绝（code 1301） | 单独识别，改写 scene 后重跑（不重试） |
| 写库失败 | 事务 + mysqldump 备份，可回滚 |
| 场景描述出现乱码文字 | BLANK_SURFACES 约束 + 负向词（school_sync 已验证） |

---

## 8. 不做的事

- **不改 `CourseCard.tsx`**：标题已在信息区渲染，封面上的烤标题是画面构图的一部分，接受重复（与 school_sync 决策一致）。
- **不改 `course-cover.ts` 解析逻辑**：两层解析（专属图 → 渐变色卡）不变。
- **不删除旧主题图**：`graded_reading__*__v*.webp` 保留在仓库（可能有其他引用），只是不再被 cover_url 指向。
- **不改其他分类**：仅处理 `graded_reading`，`practical`/`exam_prep` 不在本次范围。
