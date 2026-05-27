"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { List, CreateButton, useTable, DeleteButton } from "@refinedev/antd"
import {
  Table, Space, Switch, Button, message, Avatar,
  Modal, Form, Input, Select, Row, Col, Image,
  Upload, App,
} from "antd"
import { EyeOutlined, EditOutlined, PictureOutlined, InboxOutlined } from "@ant-design/icons"
import { COURSE_CATEGORIES } from "@/types/course"
import type { UploadFile } from "antd"

const { Dragger } = Upload

// camelCase keys from Drizzle
interface CourseRow {
  id: string
  title: string
  description: string | null
  coverUrl: string | null
  sourceName: string
  categoryKey: string | null
  subCategoryKey: string | null
  isPublished: number
  learnerCount: number
}

const mainCategories = COURSE_CATEGORIES.filter((c) => c.key !== "all")

function getCategoryLabel(key: string | null) {
  if (!key) return "-"
  for (const cat of mainCategories) {
    if (cat.key === key) return cat.label
    for (const sub of cat.subCategories) {
      if (sub.key === key) return sub.label
    }
  }
  return key
}

export default function CoursesList() {
  const router = useRouter()
  const { message: msg } = App.useApp()
  const { tableProps, tableQuery } = useTable({ pagination: { pageSize: 20 } })

  const [editModal, setEditModal] = useState<{ open: boolean; course?: CourseRow }>({ open: false })
  const [editForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null)
  const [categoryKey, setCategoryKey] = useState<string | null>(null)

  const subCategories = mainCategories.find((c) => c.key === categoryKey)?.subCategories ?? []

  async function togglePublish(id: string, checked: boolean) {
    try {
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: checked ? 1 : 0 }),
      })
      if (!res.ok) throw new Error("操作失败")
      msg.success(checked ? "已启用" : "已禁用")
      tableQuery.refetch()
    } catch {
      msg.error("操作失败")
    }
  }

  function openEditModal(course: CourseRow) {
    setCategoryKey(course.categoryKey)
    setCoverDataUrl(null)
    editForm.setFieldsValue({
      title: course.title,
      description: course.description,
      source_name: course.sourceName,
      category_key: course.categoryKey,
      sub_category_key: course.subCategoryKey,
    })
    setEditModal({ open: true, course })
  }

  async function handleImageUpload(file: File) {
    if (file.size > 1 * 1024 * 1024) { msg.error("图片不能超过 1MB"); return false }
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
      msg.error(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
    return false
  }

  async function handleEditSave(values: Record<string, string>) {
    if (!editModal.course) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/courses/${editModal.course.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          description: values.description || null,
          coverUrl: coverDataUrl ?? editModal.course.coverUrl ?? null,
          categoryKey: values.category_key || null,
          subCategoryKey: values.sub_category_key || null,
          sourceName: values.source_name || "官方",
        }),
      })
      if (!res.ok) throw new Error("保存失败")
      msg.success("保存成功")
      setEditModal({ open: false })
      tableQuery.refetch()
    } catch (err) {
      msg.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <List headerButtons={<CreateButton>新增课程</CreateButton>}>
      <Table
        {...tableProps}
        rowKey="id"
        onRow={(record) => ({
          onClick: () => router.push(`/admin/courses/${String(record.id)}`),
          style: { cursor: "pointer" },
        })}
      >
        <Table.Column
          dataIndex="coverUrl"
          title="封面"
          width={64}
          render={(url: string | null) =>
            url ? (
              <img src={url} alt="封面" style={{ width: 48, height: 27, objectFit: "cover", borderRadius: 3, display: "block" }} />
            ) : (
              <Avatar shape="square" size={48} icon={<PictureOutlined />} style={{ background: "#6366f1" }} />
            )
          }
        />
        <Table.Column dataIndex="title" title="标题" ellipsis />
        <Table.Column dataIndex="sourceName" title="来源" width={80} />
        <Table.Column
          dataIndex="categoryKey"
          title="分类"
          width={120}
          render={(v: string | null, record: CourseRow) =>
            record.subCategoryKey
              ? getCategoryLabel(record.subCategoryKey)
              : getCategoryLabel(v)
          }
        />
        <Table.Column
          dataIndex="isPublished"
          title="启用"
          width={80}
          render={(v: number, record: { id: string }) => (
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!v}
                size="small"
                onChange={(checked) => togglePublish(record.id, checked)}
              />
            </span>
          )}
        />
        <Table.Column
          dataIndex="learnerCount"
          title="学习人数"
          width={90}
        />
        <Table.Column
          title="操作"
          width={160}
          render={(_: unknown, record: CourseRow) => (
            <Space onClick={(e) => e.stopPropagation()}>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => router.push(`/admin/courses/${record.id}`)}
              >
                详情
              </Button>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditModal(record)}
              >
                编辑
              </Button>
              <DeleteButton recordItemId={record.id} hideText size="small" />
            </Space>
          )}
        />
      </Table>

      {/* 编辑课程 Modal（与详情页共用同一套表单逻辑） */}
      <Modal
        title="编辑课程信息"
        open={editModal.open}
        onCancel={() => setEditModal({ open: false })}
        footer={null}
        width={600}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSave} style={{ marginTop: 16 }}>
          <Form.Item name="title" label="课程标题" rules={[{ required: true, message: "请输入课程标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="课程简介">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="封面图片（最大 1MB）">
            <Row gutter={12}>
              <Col flex="auto">
                <Dragger
                  accept="image/*"
                  beforeUpload={handleImageUpload}
                  fileList={[] as UploadFile[]}
                  showUploadList={false}
                  disabled={uploading}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽上传新封面</p>
                </Dragger>
              </Col>
              {(coverDataUrl || editModal.course?.coverUrl) && (
                <Col>
                  <Image
                    src={coverDataUrl ?? editModal.course?.coverUrl ?? ""}
                    width={120}
                    height={67}
                    style={{ objectFit: "cover", borderRadius: 4 }}
                    preview={false}
                    alt="封面预览"
                  />
                </Col>
              )}
            </Row>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category_key" label="主分类">
                <Select
                  allowClear
                  placeholder="选择主分类"
                  options={mainCategories.map((c) => ({ label: c.label, value: c.key }))}
                  onChange={(v) => {
                    setCategoryKey(v ?? null)
                    editForm.setFieldValue("sub_category_key", undefined)
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sub_category_key" label="子分类">
                <Select
                  allowClear
                  placeholder="选择子分类"
                  disabled={!categoryKey || subCategories.length === 0}
                  options={subCategories.map((c) => ({ label: c.label, value: c.key }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="source_name" label="来源名称">
            <Input placeholder="官方" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setEditModal({ open: false })}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </List>
  )
}
