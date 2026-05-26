"use client"

import { Create, useForm } from "@refinedev/antd"
import { Form, Input, InputNumber } from "antd"

export default function LessonCreate() {
  const { formProps, saveButtonProps, form } = useForm()

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} form={form} layout="vertical">
        <Form.Item name="course_id" label="课程ID" rules={[{ required: true }]}>
          <Input placeholder="输入所属课程的 ID" />
        </Form.Item>
        <Form.Item name="title" label="课时名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="summary" label="简介">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="sort_order" label="排序" initialValue={0}>
          <InputNumber min={0} />
        </Form.Item>
      </Form>
    </Create>
  )
}
