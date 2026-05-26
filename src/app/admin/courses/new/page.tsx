"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Form, Input, Select, Button, Upload, Image, message, Card, Row, Col } from "antd"
import { InboxOutlined, ArrowLeftOutlined } from "@ant-design/icons"
import { COURSE_CATEGORIES } from "@/types/course"
import type { UploadFile } from "antd"

const { TextArea } = Input
const { Dragger } = Upload

export default function CourseNew() {
  const router = useRouter()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [categoryKey, setCategoryKey] = useState<string | null>(null)

  const mainCategories = COURSE_CATEGORIES.filter((c) => c.key !== "all")
  const subCategories = mainCategories.find((c) => c.key === categoryKey)?.subCategories ?? []

  async function handleImageUpload(file: File) {
    if (file.size > 1 * 1024 * 1024) {
      message.error("图片不能超过 1MB")
      return false
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/admin/upload/image", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCoverDataUrl(json.dataUrl)
      form.setFieldValue("cover_url", json.dataUrl)
      message.success("封面上传成功")
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
    return false
  }

  async function handleSubmit(values: Record<string, string>) {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          description: values.description || null,
          cover_url: coverDataUrl || null,
          category_key: values.category_key || null,
          sub_category_key: values.sub_category_key || null,
          source_name: values.source_name || "官方",
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      message.success("课程创建成功")
      router.push(`/admin/courses/${json.data.id}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <Button icon={<ArrowLeftOutlined />} type="link" onClick={() => router.push("/admin/courses")} style={{ marginBottom: 16, paddingLeft: 0 }}>
        返回课程列表
      </Button>

      <Card title="新建课程">
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ source_name: "官方" }}>
          <Form.Item name="title" label="课程标题" rules={[{ required: true, message: "请输入课程标题" }]}>
            <Input placeholder="请输入课程标题" />
          </Form.Item>

          <Form.Item name="description" label="课程简介">
            <TextArea rows={3} placeholder="请输入课程简介" />
          </Form.Item>

          <Form.Item label="封面图片（建议 16:9，最大 1MB）">
            <Row gutter={16}>
              <Col flex="auto">
                <Dragger
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  beforeUpload={handleImageUpload}
                  fileList={[] as UploadFile[]}
                  showUploadList={false}
                  disabled={uploading}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽上传封面图片</p>
                  <p className="ant-upload-hint">JPEG / PNG / WebP，最大 1MB</p>
                </Dragger>
              </Col>
              {coverDataUrl && (
                <Col>
                  <Image src={coverDataUrl} width={160} height={90} style={{ objectFit: "cover", borderRadius: 4 }} preview={false} alt="封面预览" />
                </Col>
              )}
            </Row>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category_key" label="主分类">
                <Select
                  placeholder="选择主分类"
                  allowClear
                  options={mainCategories.map((c) => ({ label: c.label, value: c.key }))}
                  onChange={(v) => {
                    setCategoryKey(v ?? null)
                    form.setFieldValue("sub_category_key", undefined)
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sub_category_key" label="子分类">
                <Select
                  placeholder="选择子分类"
                  allowClear
                  disabled={!categoryKey || subCategories.length === 0}
                  options={subCategories.map((c) => ({ label: c.label, value: c.key }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="source_name" label="来源名称">
            <Input placeholder="官方" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} size="large">
              创建课程
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
