"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Row, Col, Card, Typography, Button, Input, Space, Popconfirm,
  App, Spin, Drawer, Tag, Divider, Empty, Modal, Tabs, Upload,
} from "antd"
import type { UploadFile } from "antd"
import { InboxOutlined } from "@ant-design/icons"
import {
  ArrowLeftOutlined, PlusOutlined, DeleteOutlined, SaveOutlined,
  ScissorOutlined, BulbOutlined, HolderOutlined,
} from "@ant-design/icons"
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

const { Title, Text } = Typography

interface Chunk {
  order: number
  text: string
  chinese: string
}

interface Sentence {
  id: string
  english: string
  chinese: string
  sortOrder: number
  chunks: Chunk[] | null
}

function SortableItem({ id, children }: { id: string; children: (props: { dragHandle: React.ReactNode }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({
        dragHandle: (
          <span {...attributes} {...listeners} style={{ cursor: "grab", color: "#999", padding: "0 8px" }}>
            <HolderOutlined />
          </span>
        ),
      })}
    </div>
  )
}

export default function LessonDetailPage() {
  const { message } = App.useApp()
  const { id: courseId, lessonId } = useParams<{ id: string; lessonId: string }>()
  const router = useRouter()
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [lessonTitle, setLessonTitle] = useState("")
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editEnglish, setEditEnglish] = useState("")
  const [editChinese, setEditChinese] = useState("")
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [savingChunks, setSavingChunks] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisDrawer, setAnalysisDrawer] = useState(false)
  const [analysisData, setAnalysisData] = useState<Record<string, string> | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addRows, setAddRows] = useState<{ english: string; chinese: string }[]>([{ english: "", chinese: "" }])
  const [addingRows, setAddingRows] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiTab, setAiTab] = useState<"text" | "file">("text")
  const [aiText, setAiText] = useState("")
  const [aiFile, setAiFile] = useState<UploadFile | null>(null)
  const [aiGenerating, setAiGenerating] = useState(false)
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = sentences.find((s) => s.id === selectedId) ?? null

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadLesson = useCallback(async () => {
    setLoading(true)
    try {
      const [lessonRes, sentencesRes] = await Promise.all([
        fetch(`/api/admin/lessons/${lessonId}`),
        fetch(`/api/admin/sentences?lessonId=${lessonId}&pageSize=200`),
      ])
      const [lessonJson, sentencesJson] = await Promise.all([lessonRes.json(), sentencesRes.json()])
      setLessonTitle(lessonJson.data?.title ?? "")
      const rows: Sentence[] = (sentencesJson.data ?? []).sort((a: Sentence, b: Sentence) => a.sortOrder - b.sortOrder)
      setSentences(rows)
    } catch {
      message.error("加载失败")
    } finally {
      setLoading(false)
    }
  }, [lessonId])

  useEffect(() => { loadLesson() }, [loadLesson])

  function selectSentence(s: Sentence) {
    setSelectedId(s.id)
    setEditEnglish(s.english)
    setEditChinese(s.chinese)
    setChunks(s.chunks ?? [])
  }

  async function saveBasicInfo() {
    if (!selectedId) return
    try {
      await fetch(`/api/admin/sentences/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ english: editEnglish, chinese: editChinese }),
      })
      setSentences((prev) => prev.map((s) => s.id === selectedId ? { ...s, english: editEnglish, chinese: editChinese } : s))
      message.success("已保存")
    } catch {
      message.error("保存失败")
    }
  }

  async function saveChunks() {
    if (!selectedId) return
    setSavingChunks(true)
    try {
      await fetch(`/api/admin/sentences/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks }),
      })
      setSentences((prev) => prev.map((s) => s.id === selectedId ? { ...s, chunks } : s))
      message.success("断句已保存")
    } catch {
      message.error("保存失败")
    } finally {
      setSavingChunks(false)
    }
  }

  async function handleSplit() {
    if (!selectedId) return
    setSplitting(true)
    try {
      // save latest english first
      await fetch(`/api/admin/sentences/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ english: editEnglish, chinese: editChinese }),
      })
      const res = await fetch(`/api/admin/sentences/${selectedId}/split`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setChunks(json.data.chunks)
      message.success("AI 拆分完成")
    } catch (err) {
      message.error(err instanceof Error ? err.message : "AI 拆分失败")
    } finally {
      setSplitting(false)
    }
  }

  async function handleAnalyze(force = false) {
    if (!selectedId) return
    setAnalyzing(true)
    try {
      const url = `/api/admin/sentences/${selectedId}/analyze${force ? "?force=1" : ""}`
      const res = await fetch(url, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAnalysisData(json.data)
      setAnalysisDrawer(true)
      if (force) message.success("已重新生成")
    } catch (err) {
      message.error(err instanceof Error ? err.message : "分析失败")
    } finally {
      setAnalyzing(false)
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
        res = await fetch("/api/admin/ai/extract-sentences", { method: "POST", body: form })
      } else {
        if (!aiText.trim()) return message.error("请输入文本内容")
        res = await fetch("/api/admin/ai/extract-sentences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: aiText }),
        })
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const newRows: { english: string; chinese: string }[] = json.sentences ?? []
      if (newRows.length === 0) return message.warning("未提取到有效句子")
      setAddRows((prev) => {
        const existing = prev.filter((r) => r.english.trim())
        return [...existing, ...newRows]
      })
      setAiModalOpen(false)
      setAiText("")
      setAiFile(null)
      message.success(`AI 已生成 ${newRows.length} 条句子`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : "AI 生成失败")
    } finally {
      setAiGenerating(false)
    }
  }

  function openAddModal() {
    setAddRows([{ english: "", chinese: "" }])
    setAddModalOpen(true)
  }

  async function batchAddSentences() {
    const valid = addRows.filter((r) => r.english.trim())
    if (valid.length === 0) return message.error("请至少输入一条英文句子")
    setAddingRows(true)
    try {
      const results: Sentence[] = []
      for (let i = 0; i < valid.length; i++) {
        const res = await fetch("/api/admin/sentences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonId,
            english: valid[i].english.trim(),
            chinese: valid[i].chinese.trim(),
            sortOrder: sentences.length + i,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        results.push({ ...json.data, chunks: json.data.chunks ?? null })
      }
      setSentences((prev) => [...prev, ...results])
      setAddModalOpen(false)
      message.success(`已添加 ${results.length} 条句子`)
      if (results.length > 0) selectSentence(results[results.length - 1])
    } catch (err) {
      message.error(err instanceof Error ? err.message : "添加失败")
    } finally {
      setAddingRows(false)
    }
  }

  async function deleteSentence(sid: string) {
    await fetch(`/api/admin/sentences/${sid}`, { method: "DELETE" })
    setSentences((prev) => prev.filter((s) => s.id !== sid))
    if (selectedId === sid) { setSelectedId(null); setChunks([]) }
    message.success("已删除")
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSentences((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id)
      const newIndex = prev.findIndex((s) => s.id === over.id)
      const next = arrayMove(prev, oldIndex, newIndex)
      // debounced persist
      if (reorderTimer.current) clearTimeout(reorderTimer.current)
      reorderTimer.current = setTimeout(async () => {
        await fetch(`/api/admin/lessons/${lessonId}/sentences/reorder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: next.map((s) => s.id) }),
        })
      }, 800)
      return next
    })
  }

  function handleChunkDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setChunks((prev) => {
      const oldIndex = prev.findIndex((c) => c.order === Number(active.id))
      const newIndex = prev.findIndex((c) => c.order === Number(over.id))
      return arrayMove(prev, oldIndex, newIndex).map((c, i) => ({ ...c, order: i + 1 }))
    })
  }

  function updateChunk(order: number, field: "text" | "chinese", value: string) {
    setChunks((prev) => prev.map((c) => c.order === order ? { ...c, [field]: value } : c))
  }

  function deleteChunk(order: number) {
    setChunks((prev) => prev.filter((c) => c.order !== order).map((c, i) => ({ ...c, order: i + 1 })))
  }

  function addChunk() {
    setChunks((prev) => [...prev, { order: prev.length + 1, text: "", chinese: "" }])
  }

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} type="link" onClick={() => router.push(`/admin/courses/${courseId}`)} style={{ paddingLeft: 0 }}>
          返回课程详情
        </Button>
        <Text type="secondary">/ {lessonTitle}</Text>
      </Space>

      <Row gutter={16} style={{ height: "calc(100vh - 140px)" }}>
        {/* 左侧：句子列表 */}
        <Col xs={24} lg={10} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <Card
            title={`句子列表（${sentences.length} 条）`}
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddModal}>
                添加句子
              </Button>
            }
            style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
            styles={{ body: { flex: 1, overflow: "auto", padding: "8px 0" } }}
          >
            {sentences.length === 0 ? (
              <Empty description="暂无句子，点击右上角添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sentences.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {sentences.map((s) => (
                    <SortableItem key={s.id} id={s.id}>
                      {({ dragHandle }) => (
                        <div
                          onClick={() => selectSentence(s)}
                          style={{
                            display: "flex", alignItems: "center", padding: "8px 12px", cursor: "pointer",
                            background: selectedId === s.id ? "rgba(99, 102, 241, 0.15)" : "transparent",
                            borderLeft: selectedId === s.id ? "3px solid #6366f1" : "3px solid transparent",
                          }}
                        >
                          {dragHandle}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Text ellipsis style={{ display: "block", fontSize: 13 }}>{s.english || <Text type="secondary">（空句子）</Text>}</Text>
                            <Text type="secondary" ellipsis style={{ display: "block", fontSize: 12 }}>{s.chinese}</Text>
                          </div>
                          {s.chunks && s.chunks.length > 0 && (
                            <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>{s.chunks.length}段</Tag>
                          )}
                          <Popconfirm title="删除此句子？" onConfirm={(e) => { e?.stopPropagation(); deleteSentence(s.id) }} onCancel={(e) => e?.stopPropagation()}>
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                          </Popconfirm>
                        </div>
                      )}
                    </SortableItem>
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </Card>
        </Col>

        {/* 右侧：编辑面板 */}
        <Col xs={24} lg={14} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <Card style={{ flex: 1 }}>
              <Empty description="请在左侧选择一个句子" />
            </Card>
          ) : (
            <Card
              style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
              styles={{ body: { flex: 1, overflow: "auto" } }}
              title={<Text strong>编辑句子</Text>}
              extra={
                <Space>
                  <Button icon={<BulbOutlined />} loading={analyzing} onClick={() => handleAnalyze()} size="small">
                    句子分析
                  </Button>
                  <Button icon={<ScissorOutlined />} loading={splitting} onClick={handleSplit} size="small" type="primary">
                    AI 拆分
                  </Button>
                </Space>
              }
            >
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <div>
                  <Text strong style={{ fontSize: 12 }}>英文句子</Text>
                  <Input.TextArea
                    rows={2}
                    value={editEnglish}
                    onChange={(e) => setEditEnglish(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                </div>
                <div>
                  <Text strong style={{ fontSize: 12 }}>中文翻译</Text>
                  <Input
                    value={editChinese}
                    onChange={(e) => setEditChinese(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                </div>
                <Button icon={<SaveOutlined />} onClick={saveBasicInfo} size="small">
                  保存句子内容
                </Button>

                <Divider style={{ margin: "4px 0" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>断句列表（可拖拽排序）</Text>
                </Divider>

                {chunks.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>暂无断句，点击「AI 拆分」自动生成，或手动添加</Text>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleChunkDragEnd}>
                    <SortableContext items={chunks.map((c) => String(c.order))} strategy={verticalListSortingStrategy}>
                      {chunks.map((chunk) => (
                        <SortableItem key={String(chunk.order)} id={String(chunk.order)}>
                          {({ dragHandle }) => (
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                              {dragHandle}
                              <Tag style={{ minWidth: 24, textAlign: "center", flexShrink: 0 }}>{chunk.order}</Tag>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Input
                                  size="small"
                                  value={chunk.text}
                                  onChange={(e) => updateChunk(chunk.order, "text", e.target.value)}
                                  placeholder="短语英文"
                                  style={{ marginBottom: 4 }}
                                />
                                <Input
                                  size="small"
                                  value={chunk.chinese}
                                  onChange={(e) => updateChunk(chunk.order, "chinese", e.target.value)}
                                  placeholder="短语中文"
                                />
                              </div>
                              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteChunk(chunk.order)} />
                            </div>
                          )}
                        </SortableItem>
                      ))}
                    </SortableContext>
                  </DndContext>
                )}

                <Space>
                  <Button size="small" icon={<PlusOutlined />} onClick={addChunk}>添加短句</Button>
                  <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveChunks} loading={savingChunks}>
                    保存断句
                  </Button>
                </Space>
              </Space>
            </Card>
          )}
        </Col>
      </Row>

      {/* 批量添加句子 Modal */}
      <Modal
        title="批量添加句子"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={batchAddSentences}
        okText={`添加 ${addRows.filter((r) => r.english.trim()).length} 条`}
        okButtonProps={{ loading: addingRows, disabled: addRows.filter((r) => r.english.trim()).length === 0 }}
        width={700}
        destroyOnHidden
      >
        {/* 表头 */}
        <div style={{ display: "flex", gap: 8, padding: "0 0 6px", borderBottom: "1px solid var(--ant-color-border)", marginBottom: 8 }}>
          <div style={{ width: 28, flexShrink: 0, fontSize: 12, color: "var(--ant-color-text-secondary)", textAlign: "center" }}>#</div>
          <div style={{ flex: 2, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>英文句子 *</div>
          <div style={{ flex: 1, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>中文翻译（可选）</div>
          <div style={{ width: 32, flexShrink: 0 }} />
        </div>
        {/* 行列表 */}
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {addRows.map((row, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
              <div style={{ width: 28, flexShrink: 0, paddingTop: 6, fontSize: 12, color: "var(--ant-color-text-secondary)", textAlign: "center" }}>
                {idx + 1}
              </div>
              <Input.TextArea
                style={{ flex: 2 }}
                rows={2}
                placeholder="请输入英文句子"
                value={row.english}
                onChange={(e) => setAddRows((prev) => prev.map((r, i) => i === idx ? { ...r, english: e.target.value } : r))}
              />
              <Input
                style={{ flex: 1, marginTop: 2 }}
                placeholder="中文翻译"
                value={row.chinese}
                onChange={(e) => setAddRows((prev) => prev.map((r, i) => i === idx ? { ...r, chinese: e.target.value } : r))}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                style={{ marginTop: 4, flexShrink: 0 }}
                disabled={addRows.length === 1}
                onClick={() => setAddRows((prev) => prev.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
        <Space style={{ marginTop: 8, width: "100%" }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() => setAddRows((prev) => [...prev, { english: "", chinese: "" }])}
          >
            添加一行
          </Button>
          <Button
            type="dashed"
            onClick={() => { setAiTab("text"); setAiModalOpen(true) }}
          >
            一键 AI 生成
          </Button>
        </Space>
      </Modal>

      {/* AI 智能生成 Modal */}
      <Modal
        title="AI 智能生成句子"
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); setAiFile(null) }}
        footer={null}
        width={600}
        destroyOnHidden
      >
        <Tabs
          activeKey={aiTab}
          onChange={(k) => setAiTab(k as "text" | "file")}
          items={[
            {
              key: "text",
              label: "粘贴文本",
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input.TextArea
                    rows={12}
                    maxLength={2000}
                    showCount
                    placeholder="粘贴英文教材、文章或对话文本，AI 将自动提取句子并生成中文翻译…"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    style={{ resize: "none" }}
                  />
                  <Button
                    type="primary"
                    block
                    loading={aiGenerating}
                    disabled={!aiText.trim()}
                    onClick={handleAiGenerate}
                  >
                    AI 生成句子
                  </Button>
                </Space>
              ),
            },
            {
              key: "file",
              label: "上传文件",
              children: (
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
                    <p style={{ fontSize: 14, marginTop: 8 }}>点击或拖拽文件到此处上传</p>
                    <p style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                      支持 PDF、Word（.docx/.doc）、TXT，单文件不超过 10MB
                    </p>
                  </Upload.Dragger>
                  <Button
                    type="primary"
                    block
                    loading={aiGenerating}
                    disabled={!aiFile}
                    onClick={handleAiGenerate}
                  >
                    AI 生成句子
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      {/* 句子成分分析 Drawer */}
      <Drawer
        title={`句子分析：${selected?.english ?? ""}`}
        open={analysisDrawer}
        onClose={() => setAnalysisDrawer(false)}
        width={520}
        extra={
          <Button size="small" loading={analyzing} onClick={() => handleAnalyze(true)}>
            重新生成
          </Button>
        }
      >
        {analyzing && <Spin />}
        {analysisData && (
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            {[
              ["中文解释", "chineseExplanation"],
              ["语法分析", "grammarAnalysis"],
              ["单词注解", "wordAnnotations"],
              ["文化背景", "cultureNotes"],
              ["使用场景", "usageScenarios"],
              ["相关例句", "relatedExamples"],
            ].map(([label, key]) => (
              <div key={key}>
                <Title level={5} style={{ marginBottom: 4 }}>{label}</Title>
                <Text style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{analysisData[key]}</Text>
              </div>
            ))}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
