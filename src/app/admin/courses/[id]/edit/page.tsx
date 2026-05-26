"use client"

import { Edit, useForm } from "@refinedev/antd"
import { Form, Input, Select, Switch } from "antd"

export default function CourseEdit() {
  const { formProps, saveButtonProps } = useForm()

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item name="title" label="课程标题" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="课程描述">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="cover_url" label="封面图片 URL">
          <Input />
        </Form.Item>
        <Form.Item name="source_name" label="来源名称">
          <Input />
        </Form.Item>
        <Form.Item name="category_key" label="分类">
          <Select
            allowClear
            options={[
              { label: "日常生活", value: "daily" },
              { label: "职场英语", value: "workplace" },
              { label: "旅游出行", value: "travel" },
              { label: "影视娱乐", value: "entertainment" },
              { label: "考试备考", value: "exam" },
            ]}
          />
        </Form.Item>
        <Form.Item name="is_published" label="发布状态" valuePropName="checked">
          <Switch checkedChildren="已发布" unCheckedChildren="草稿" />
        </Form.Item>
      </Form>
    </Edit>
  )
}
