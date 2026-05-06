"use client"

import { Create, useForm } from "@refinedev/antd"
import { Form, Input, InputNumber, Select } from "antd"

export default function SentenceCreate() {
  const { formProps, saveButtonProps } = useForm()

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item name="chinese" label="中文" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="english" label="英文" rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="category" label="分类" rules={[{ required: true }]}>
          <Select
            options={[
              { label: "日常对话", value: "daily" },
              { label: "出行旅游", value: "travel" },
              { label: "职场英语", value: "workplace" },
              { label: "社交媒体", value: "social" },
              { label: "影视台词", value: "movies" },
              { label: "考试必备", value: "exam" },
            ]}
          />
        </Form.Item>
        <Form.Item name="difficulty" label="难度" initialValue={1}>
          <Select
            options={[
              { label: "简单", value: 1 },
              { label: "中等", value: 2 },
              { label: "较难", value: 3 },
            ]}
          />
        </Form.Item>
        <Form.Item name="words_count" label="词数">
          <InputNumber min={1} />
        </Form.Item>
      </Form>
    </Create>
  )
}
