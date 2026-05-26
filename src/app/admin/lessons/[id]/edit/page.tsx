"use client"

import { Edit, useForm } from "@refinedev/antd"
import { Form, Input, InputNumber } from "antd"

export default function LessonEdit() {
  const { formProps, saveButtonProps } = useForm()

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item name="course_id" label="课程ID" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="title" label="课时名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="summary" label="简介">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="sort_order" label="排序">
          <InputNumber min={0} />
        </Form.Item>
      </Form>
    </Edit>
  )
}
