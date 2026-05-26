"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Row, Col, Card, Typography, Button, Tag, Table, Modal, Form,
  Input, Space, Popconfirm, message, Spin, Tooltip, Image,
  Select, Collapse, Progress,
} from "antd"
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  ThunderboltOutlined, UnorderedListOutlined, MinusCircleOutlined,
} from "@ant-design/icons"
import { COURSE_CATEGORIES } from "@/types/course"
import { InboxOutlined } from "@ant-design/icons"
import { Upload } from "antd"
import type { UploadFile } from "antd"

const { Title, Text, Paragraph } = Typography
const { Dragger } = Upload

interface Lesson {
  id: string
  courseId: string
  title: string
  summary: string | null
  sortOrder: number
  createdAt: string
}

interface PreviewLesson {
  title: string
  summary: string
  sentences: { english: string; chinese: string }[]
}

interface CourseDetail {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  categoryKey: string | null
  subCategoryKey: string | null
  sourceName: string
  isPublished: number
  learnerCount: number
  createdAt: string
  lessons: Lesson[]
}

function getCategoryLabel(key: string | null) {
  if (!key) return "-"
  for (const cat of COURSE_CATEGORIES) {
    if (cat.key === key) return cat.label
    for (const sub of cat.subCategories) {
      if (sub.key === key) return sub.label
    }
  }
  return key
}

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [lessonModal, setLessonModal] = useState<{ open: boolean; lesson?: Lesson }>({ open: false })
  const [editModal, setEditModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [lessonForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [categoryKey, setCategoryKey] = useState<string | null>(null)

  const [aiInputOpen, setAiInputOpen] = useState(false)
  const [aiTab, setAiTab] = useState<"text" | "file">("text")
  const [aiText, setAiText] = useState("")
  const [aiFile, setAiFile] = useState<UploadFile | null>(null)
  const [aiLessonCount, setAiLessonCount] = useState("auto")
  const [aiSentencesPerLesson, setAiSentencesPerLesson] = useState("auto")
  const [aiGenerating, setAiGenerating] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLessons, setPreviewLessons] = useState<PreviewLesson[]>([])
  const [creating, setCreating] = useState(false)
  const [createProgress, setCreateProgress] = useState("")

  const mainCategories = COURSE_CATEGORIES.filter((c) => c.key !== "all")
  const subCategories = mainCategories.find((c) => c.key === categoryKey)?.subCategories ?? []

  const loadCourse = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/courses/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCourse(json.data)
    } catch {
      message.error("加载失败")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadCourse() }, [loadCourse])

  async function handleImageUpload(file: File) {
    if (file.size > 1 * 1024 * 1024) { message.error("图片不能超过 1MB"); return false }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/admin/upload/image", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCoverDataUrl(json.dataUrl)
      editForm.setFieldValue("cover_url", json.dataUrl)
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
    return false
  }

  function openEditModal() {
    if (!course) return
    setCategoryKey(course.categoryKey)
    setCoverDataUrl(course.coverUrl)
    editForm.setFieldsValue({
      title: course.title,
      description: course.description,
      source_name: course.sourceName,
      category_key: course.categoryKey,
      sub_category_key: course.subCategoryKey,
    })
    setEditModal(true)
  }

  async function handleEditSave(values: Record<string, string>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          description: values.description || null,
          cover_url: coverDataUrl ?? course?.coverUrl ?? null,
          category_key: values.category_key || null,
          sub_category_key: values.sub_category_key || null,
          source_name: values.source_name || "官方",
        }),
      })
      if (!res.ok) throw new Error("保存失败")
      message.success("保存成功")
      setEditModal(false)
      loadCourse()
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleLessonSave(values: { title: string; summary?: string }) {
    setSaving(true)
    try {
      const isEdit = !!lessonModal.lesson
      const url = isEdit ? `/api/admin/lessons/${lessonModal.lesson!.id}` : "/api/admin/lessons"
      const method = isEdit ? "PUT" : "POST"
      const body = isEdit
        ? { title: values.title, summary: values.summary || null }
        : { courseId: id, title: values.title, summary: values.summary || null, sortOrder: (course?.lessons.length ?? 0) }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("保存失败")
      message.success(isEdit ? "章节已更新" : "章节已创建")
      setLessonModal({ open: false })
      lessonForm.resetFields()
      loadCourse()
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function deleteLesson(lessonId: string) {
    try {
      const res = await fetch(`/api/admin/lessons/${lessonId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("删除失败")
      message.success("章节已删除")
      loadCourse()
    } catch {
      message.error("删除失败")
    }
  }

  async function handleAiGenerate() {
    setAiGenerating(true)
    try {
      let res: Response
      if (aiTab === "file") {
        if (!aiFile?.originFileObj) return message.error("请先选择文件")
        const form = new FormData()
        form.append("file", aiFile.originFileObj)
        form.append("lessonCount", aiLessonCount)
        form.append("sentencesPerLesson", aiSentencesPerLesson)
        res = await fetch(`/api/admin/courses/${id}/ai-generate`, { method: "POST", body: form })
      } else {
        if (!aiText.trim()) return message.error("请输入文本内容")
        res = await fetch(`/api/admin/courses/${id}/ai-generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: aiText, lessonCount: aiLessonCount, sentencesPerLesson: aiSentencesPerLesson }),
        })
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPreviewLessons(json.lessons)
      setAiInputOpen(false)
      setPreviewOpen(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : "AI 生成失败")
    } finally {
      setAiGenerating(false)
    }
  }

  async function handleConfirmCreate() {
    setCreating(true)
    const baseOrder = course?.lessons.length ?? 0
    try {
      for (let i = 0; i < previewLessons.length; i++) {
        const pl = previewLessons[i]
        setCreateProgress(`正在创建第 ${i + 1}/${previewLessons.length} 章节…`)
        const lessonRes = await fetch("/api/admin/lessons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseId: id, title: pl.title, summary: pl.summary || null, sortOrder: baseOrder + i }),
        })
        const lessonJson = await lessonRes.json()
        if (!lessonRes.ok) throw new Error(lessonJson.error)
        const newLessonId: string = lessonJson.data.id
        for (let j = 0; j < pl.sentences.length; j++) {
          const s = pl.sentences[j]
          await fetch("/api/admin/sentences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lessonId: newLessonId, english: s.english, chinese: s.chinese, sortOrder: j }),
          })
        }
      }
      const totalSentences = previewLessons.reduce((sum, l) => sum + l.sentences.length, 0)
      message.success(`已创建 ${previewLessons.length} 个章节，${totalSentences} 条句子`)
      setPreviewOpen(false)
      setAiText("")
      setAiFile(null)
      loadCourse()
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setCreating(false)
      setCreateProgress("")
    }
  }

  const lessonColumns = [
    { dataIndex: "sortOrder", title: "序号", width: 60, render: (v: number) => v + 1 },
    { dataIndex: "title", title: "标题", ellipsis: true },
    { dataIndex: "summary", title: "简介", ellipsis: true, render: (v: string | null) => v ?? "-" },
    {
      title: "操作",
      width: 160,
      render: (_: unknown, record: Lesson) => (
        <Space>
          <Button size="small" icon={<UnorderedListOutlined />}
            onClick={() => router.push(`/admin/courses/${id}/lessons/${record.id}`)}>
            详情
          </Button>
          <Button size="small" icon={<EditOutlined />}
            onClick={() => { lessonForm.setFieldsValue({ title: record.title, summary: record.summary }); setLessonModal({ open: true, lesson: record }) }}>
            编辑
          </Button>
          <Popconfirm title="确定删除此章节？" onConfirm={() => deleteLesson(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>
  if (!course) return <div style={{ padding: 24 }}>课程不存在</div>

  return (
    <div style={{ padding: 24 }}>
      <Button icon={<ArrowLeftOutlined />} type="link" onClick={() => router.push("/admin/courses")} style={{ paddingLeft: 0, marginBottom: 16 }}>
        返回课程列表
      </Button>

      <Row gutter={24}>
        {/* 左侧：基本信息 */}
        <Col xs={24} lg={8}>
          <Card
            title="课程信息"
            extra={<Button size="small" icon={<EditOutlined />} onClick={openEditModal}>编辑</Button>}
          >
            {course.coverUrl ? (
              <Image src={course.coverUrl} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 4, marginBottom: 16 }} preview={false} alt="封面" />
            ) : (
              <div style={{ width: "100%", aspectRatio: "16/9", background: "linear-gradient(135deg,#6366f1,#a855f7)", borderRadius: 4, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 14 }}>暂无封面</Text>
              </div>
            )}
            <Title level={4} style={{ marginTop: 0 }}>{course.title}</Title>
            {course.description && <Paragraph type="secondary" style={{ fontSize: 13 }}>{course.description}</Paragraph>}
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                分类：{getCategoryLabel(course.subCategoryKey) !== "-" ? getCategoryLabel(course.subCategoryKey) : getCategoryLabel(course.categoryKey)}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>来源：{course.sourceName}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>学习人数：{course.learnerCount}</Text>
              <Tag color={course.isPublished ? "green" : "default"} style={{ marginTop: 8 }}>
                {course.isPublished ? "已启用" : "未启用"}
              </Tag>
            </Space>
          </Card>
        </Col>

        {/* 右侧：章节列表 */}
        <Col xs={24} lg={16}>
          <Card
            title={`章节列表（共 ${course.lessons.length} 节）`}
            extra={
              <Space>
                <Button icon={<ThunderboltOutlined />} onClick={() => { setAiTab("text"); setAiInputOpen(true) }}>
                  一键生成
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => { lessonForm.resetFields(); setLessonModal({ open: true }) }}>
                  新增章节
                </Button>
              </Space>
            }
          >
            <Table
              dataSource={course.lessons}
              columns={lessonColumns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>

      {/* 编辑基本信息 Modal */}
      <Modal title="编辑课程信息" open={editModal} onCancel={() => setEditModal(false)} footer={null} width={600}>
        <Form form={editForm} layout="vertical" onFinish={handleEditSave} style={{ marginTop: 16 }}>
          <Form.Item name="title" label="课程标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="封面图片（最大 1MB）">
            <Row gutter={12}>
              <Col flex="auto">
                <Dragger accept="image/*" beforeUpload={handleImageUpload} fileList={[] as UploadFile[]} showUploadList={false} disabled={uploading}>
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽上传</p>
                </Dragger>
              </Col>
              {(coverDataUrl || course.coverUrl) && (
                <Col>
                  <Image src={coverDataUrl ?? course.coverUrl ?? ""} width={120} height={67} style={{ objectFit: "cover", borderRadius: 4 }} preview={false} alt="预览" />
                </Col>
              )}
            </Row>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category_key" label="主分类">
                <Input.Search readOnly style={{ display: "none" }} />
                <select
                  style={{ width: "100%", padding: "4px 8px", border: "1px solid #d9d9d9", borderRadius: 6, background: "transparent", color: "inherit" }}
                  value={categoryKey ?? ""}
                  onChange={(e) => { setCategoryKey(e.target.value || null); editForm.setFieldValue("category_key", e.target.value || null); editForm.setFieldValue("sub_category_key", null) }}
                >
                  <option value="">不限</option>
                  {mainCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sub_category_key" label="子分类">
                <select
                  style={{ width: "100%", padding: "4px 8px", border: "1px solid #d9d9d9", borderRadius: 6, background: "transparent", color: "inherit" }}
                  disabled={!categoryKey}
                  defaultValue=""
                >
                  <option value="">不限</option>
                  {subCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="source_name" label="来源名称">
            <Input />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setEditModal(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增/编辑章节 Modal */}
      <Modal
        title={lessonModal.lesson ? "编辑章节" : "新增章节"}
        open={lessonModal.open}
        onCancel={() => setLessonModal({ open: false })}
        footer={null}
      >
        <Form form={lessonForm} layout="vertical" onFinish={handleLessonSave} style={{ marginTop: 16 }}>
          <Form.Item name="title" label="章节标题" rules={[{ required: true, message: "请输入章节标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="summary" label="章节简介">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setLessonModal({ open: false })}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* AI 一键生成 - 输入 Modal */}
      <Modal
        title="AI 一键生成课程内容"
        open={aiInputOpen}
        onCancel={() => { setAiInputOpen(false); setAiFile(null) }}
        footer={null}
        width={620}
        destroyOnHidden
      >
        {/* 参数行 */}
        <Row gutter={16} style={{ marginBottom: 16, marginTop: 8 }}>
          <Col span={12}>
            <Space>
              <Text style={{ fontSize: 13, whiteSpace: "nowrap" }}>章节数量</Text>
              <Select value={aiLessonCount} onChange={setAiLessonCount} style={{ width: 100 }} size="small"
                options={[
                  { value: "auto", label: "自动" },
                  { value: "3", label: "3 章" },
                  { value: "5", label: "5 章" },
                  { value: "8", label: "8 章" },
                  { value: "10", label: "10 章" },
                ]}
              />
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <Text style={{ fontSize: 13, whiteSpace: "nowrap" }}>每章句数</Text>
              <Select value={aiSentencesPerLesson} onChange={setAiSentencesPerLesson} style={{ width: 100 }} size="small"
                options={[
                  { value: "auto", label: "自动" },
                  { value: "5", label: "5 句" },
                  { value: "8", label: "8 句" },
                  { value: "10", label: "10 句" },
                  { value: "15", label: "15 句" },
                ]}
              />
            </Space>
          </Col>
        </Row>

        {/* 两个 Tab */}
        <div style={{ borderBottom: "1px solid var(--ant-color-border)", marginBottom: 16, display: "flex", gap: 0 }}>
          {(["text", "file"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setAiTab(key)}
              style={{
                padding: "8px 16px", border: "none", background: "none", cursor: "pointer",
                fontSize: 14, fontWeight: aiTab === key ? 600 : 400,
                color: aiTab === key ? "#6366f1" : "inherit",
                borderBottom: aiTab === key ? "2px solid #6366f1" : "2px solid transparent",
              }}
            >
              {key === "text" ? "粘贴文本" : "上传文件"}
            </button>
          ))}
        </div>

        {aiTab === "text" ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input.TextArea
              rows={12}
              maxLength={5000}
              showCount
              placeholder="粘贴英文教材、文章或对话文本，AI 将自动划分章节并生成练习句子…"
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              style={{ resize: "none" }}
            />
            <Button type="primary" block loading={aiGenerating} disabled={!aiText.trim()} onClick={handleAiGenerate}>
              开始生成
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Upload.Dragger
              accept=".pdf,.docx,.doc,.txt"
              maxCount={1}
              beforeUpload={() => false}
              fileList={aiFile ? [aiFile] : []}
              onChange={({ fileList }) => setAiFile(fileList[fileList.length - 1] ?? null)}
              style={{ padding: "24px 0" }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 40, color: "#6366f1" }} />
              </p>
              <p style={{ fontSize: 14, marginTop: 8 }}>点击或拖拽文件到此处</p>
              <p style={{ fontSize: 12, color: "#999", marginTop: 4 }}>支持 PDF、Word（.docx/.doc）、TXT</p>
            </Upload.Dragger>
            <Button type="primary" block loading={aiGenerating} disabled={!aiFile} onClick={handleAiGenerate}>
              开始生成
            </Button>
          </Space>
        )}
      </Modal>

      {/* AI 一键生成 - 预览 Modal */}
      <Modal
        title={`预览生成结果（${previewLessons.length} 个章节，${previewLessons.reduce((n, l) => n + l.sentences.length, 0)} 条句子）`}
        open={previewOpen}
        onCancel={() => !creating && setPreviewOpen(false)}
        width={900}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setPreviewOpen(false)} disabled={creating}>取消</Button>
            <Button
              type="primary"
              loading={creating}
              disabled={previewLessons.length === 0}
              onClick={handleConfirmCreate}
            >
              确认创建 {previewLessons.length} 章节 / {previewLessons.reduce((n, l) => n + l.sentences.length, 0)} 句子
            </Button>
          </Space>
        }
      >
        {creating && (
          <div style={{ marginBottom: 16 }}>
            <Progress percent={Math.round((previewLessons.indexOf(previewLessons.find((_, i) => createProgress.includes(`${i + 1}/`)) ?? previewLessons[0]) / previewLessons.length) * 100)} status="active" />
            <Text type="secondary" style={{ fontSize: 12 }}>{createProgress}</Text>
          </div>
        )}
        <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
          <Collapse
            defaultActiveKey={previewLessons.map((_, i) => String(i))}
            items={previewLessons.map((lesson, li) => ({
              key: String(li),
              label: (
                <Space onClick={(e) => e.stopPropagation()} style={{ width: "100%" }}>
                  <Input
                    size="small"
                    value={lesson.title}
                    onChange={(e) => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, title: e.target.value } : l))}
                    style={{ width: 220, fontWeight: 600 }}
                    placeholder="章节标题"
                  />
                  <Input
                    size="small"
                    value={lesson.summary}
                    onChange={(e) => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, summary: e.target.value } : l))}
                    style={{ flex: 1, minWidth: 160 }}
                    placeholder="章节简介"
                  />
                </Space>
              ),
              extra: (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => { e.stopPropagation(); setPreviewLessons((prev) => prev.filter((_, i) => i !== li)) }}
                />
              ),
              children: (
                <div>
                  {/* 表头 */}
                  <div style={{ display: "flex", gap: 8, padding: "0 0 6px", borderBottom: "1px solid var(--ant-color-border)", marginBottom: 6 }}>
                    <div style={{ flex: 2, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>英文句子</div>
                    <div style={{ flex: 1, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>中文翻译</div>
                    <div style={{ width: 32 }} />
                  </div>
                  {lesson.sentences.map((s, si) => (
                    <div key={si} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                      <Input
                        size="small"
                        style={{ flex: 2 }}
                        value={s.english}
                        onChange={(e) => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, sentences: l.sentences.map((ss, j) => j === si ? { ...ss, english: e.target.value } : ss) } : l))}
                      />
                      <Input
                        size="small"
                        style={{ flex: 1 }}
                        value={s.chinese}
                        onChange={(e) => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, sentences: l.sentences.map((ss, j) => j === si ? { ...ss, chinese: e.target.value } : ss) } : l))}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, sentences: l.sentences.filter((_, j) => j !== si) } : l))}
                      />
                    </div>
                  ))}
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    style={{ marginTop: 4 }}
                    onClick={() => setPreviewLessons((prev) => prev.map((l, i) => i === li ? { ...l, sentences: [...l.sentences, { english: "", chinese: "" }] } : l))}
                  >
                    添加句子
                  </Button>
                </div>
              ),
            }))}
          />
        </div>
      </Modal>
    </div>
  )
}
