"use client"

import { useState } from "react"
import {
  Upload,
  Button,
  Select,
  Table,
  Tag,
  Steps,
  message,
  Card,
  Space,
  Typography,
  Input,
  Spin,
} from "antd"
import { InboxOutlined, SendOutlined, SaveOutlined } from "@ant-design/icons"
import type { UploadFile } from "antd"

const { Dragger } = Upload
const { Title, Text } = Typography

interface SentencePreview {
  english: string
  chinese: string
  difficulty: number
  words: Array<{ english: string; chinese: string; phonetic: string; pos: string }>
  chunks: Array<{ order: number; text: string; chinese: string }>
}

export default function MaterialsPage() {
  const [step, setStep] = useState(0)
  const [lessonId, setLessonId] = useState("")
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [importId, setImportId] = useState<string | null>(null)
  const [sentences, setSentences] = useState<SentencePreview[]>([])
  const [loading, setLoading] = useState(false)

  async function handleUpload() {
    const file = fileList[0]?.originFileObj
    if (!file) return message.error("请选择文件")

    setLoading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      if (lessonId) form.append("lesson_id", lessonId)

      const res = await fetch("/api/admin/materials/upload", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      setImportId(json.data.id)
      setStep(1)
      message.success("文件上传成功")
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败")
    } finally {
      setLoading(false)
    }
  }

  async function handleAnalyze() {
    if (!importId) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin/materials/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      setSentences(json.data)
      setStep(2)
      message.success(`AI 解析完成，共 ${json.data.length} 条句子`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : "AI 分析失败")
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/materials/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lessonId || undefined, sentences }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      message.success(`已保存 ${json.data.savedCount} 条句子`)
      setStep(0)
      setFileList([])
      setImportId(null)
      setSentences([])
      setLessonId("")
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { dataIndex: "english", title: "英文", ellipsis: true, width: "30%" },
    { dataIndex: "chinese", title: "中文", ellipsis: true, width: "25%" },
    {
      dataIndex: "difficulty",
      title: "难度",
      width: 70,
      render: (d: number) => (
        <Tag color={d === 1 ? "green" : d === 2 ? "gold" : "red"}>
          {d === 1 ? "简单" : d === 2 ? "中等" : "较难"}
        </Tag>
      ),
    },
    {
      dataIndex: "chunks",
      title: "断句数",
      width: 80,
      render: (chunks: SentencePreview["chunks"]) => chunks?.length ?? 0,
    },
    {
      dataIndex: "words",
      title: "词汇数",
      width: 80,
      render: (words: SentencePreview["words"]) => words?.length ?? 0,
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>教材导入</Title>

      <Steps
        current={step}
        style={{ marginBottom: 32 }}
        items={[
          { title: "上传文件" },
          { title: "AI 解析" },
          { title: "确认保存" },
        ]}
      />

      {step === 0 && (
        <Card>
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <div>
              <Text strong>关联课时 ID（可选）</Text>
              <Input
                style={{ marginTop: 8 }}
                placeholder="留空则不关联课时"
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
              />
            </div>
            <Dragger
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              accept=".pdf,.txt"
              maxCount={1}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽上传 PDF / TXT 文件</p>
              <p className="ant-upload-hint">支持单个文件，最大 10MB</p>
            </Dragger>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleUpload}
              loading={loading}
              disabled={fileList.length === 0}
            >
              上传文件
            </Button>
          </Space>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <Space direction="vertical" size="large">
            <Text>文件已上传，点击下方按钮开始 AI 解析句子（可能需要 30-60 秒）</Text>
            <Button
              type="primary"
              onClick={handleAnalyze}
              loading={loading}
              icon={loading ? <Spin size="small" /> : undefined}
            >
              开始 AI 解析
            </Button>
          </Space>
        </Card>
      )}

      {step === 2 && (
        <Card
          title={`预览句子（共 ${sentences.length} 条）`}
          extra={
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
            >
              确认保存
            </Button>
          }
        >
          <Table
            dataSource={sentences}
            columns={columns}
            rowKey="english"
            pagination={{ pageSize: 20 }}
            size="small"
            expandable={{
              expandedRowRender: (record) => (
                <div style={{ padding: "8px 0" }}>
                  <Text strong>断句预览：</Text>
                  <Space wrap style={{ marginTop: 8 }}>
                    {record.chunks?.map((c) => (
                      <Tag key={c.order} color="blue">
                        {c.order}. {c.text}（{c.chinese}）
                      </Tag>
                    ))}
                  </Space>
                </div>
              ),
            }}
          />
        </Card>
      )}
    </div>
  )
}
