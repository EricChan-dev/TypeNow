"use client"

/**
 * 内容行的「删除 / 恢复」操作。
 *
 * 为什么不用 refine 自带的 DeleteButton：
 *   1. 它调用 dataProvider.deleteOne → DELETE，本身没问题，但它没有任何确认，
 *      而删一门课程会连带影响最多 16,891 条课时 —— 那个规模必须让使用者先看到；
 *   2. 恢复需要 PATCH 同一个地址，DeleteButton 表达不了。
 *
 * 删除前的二次确认会先请求影响面（`<basePath>/<id>/impact`，仅 hasChildren 时），
 * 把"将同时移入回收站：N 个课时、M 个句子"写进弹窗。没有这个数字，
 * 「删除」和「删掉一万六千条课时」在界面上长得一模一样。
 *
 * 删除是软删除（可恢复），所以文案用"移入回收站"而不是"永久删除"——
 * 说清楚可恢复，使用者才敢用。
 */

import { useState } from "react"
import { App, Button, Space, Typography } from "antd"
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons"

const { Text } = Typography

interface Impact {
  lessons: number
  sentences: number
}

interface Props {
  /** 资源接口前缀，例如 /api/admin/courses */
  basePath: string
  id: string
  isDeleted: boolean
  /** 是否有子内容需要连带统计（课程、课时为 true；句子为 false） */
  hasChildren?: boolean
  /** 操作成功后的回调（通常是刷新列表） */
  onDone: () => void
  size?: "small" | "middle"
}

export default function DeleteRestoreButton({
  basePath,
  id,
  isDeleted,
  hasChildren = false,
  onDone,
  size = "small",
}: Props) {
  const { message, modal } = App.useApp()
  const [busy, setBusy] = useState(false)

  async function fetchImpact(): Promise<Impact | null> {
    try {
      const res = await fetch(`${basePath}/${id}/impact`)
      if (!res.ok) return null
      const json = (await res.json()) as { data?: Impact }
      return json.data ?? null
    } catch {
      // 拿不到影响面不阻塞删除，只是弹窗里少一行说明
      return null
    }
  }

  async function doDelete() {
    setBusy(true)
    try {
      const res = await fetch(`${basePath}/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        message.error(json?.error ?? "删除失败")
        return
      }
      message.success("已移入回收站，可在「回收站」视图里恢复")
      onDone()
    } catch {
      message.error("删除失败")
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!hasChildren) {
      modal.confirm({
        title: "移入回收站？",
        content: "删除后可在列表上方的「回收站」视图里恢复。",
        okText: "移入回收站",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: doDelete,
      })
      return
    }

    const impact = await fetchImpact()
    const detail = impact
      ? `将同时移入回收站：${impact.lessons} 个课时、${impact.sentences} 条句子。`
      : "影响面统计暂时取不到，但删除会连带它的全部下级内容。"

    modal.confirm({
      title: "移入回收站？",
      width: 460,
      content: (
        <Space direction="vertical" size={4}>
          <Text>{detail}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            内容不会从库里删除，可以在这个列表的「回收站」视图里整体恢复。
          </Text>
        </Space>
      ),
      okText: "移入回收站",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: doDelete,
    })
  }

  async function doRestore() {
    setBusy(true)
    try {
      const res = await fetch(`${basePath}/${id}`, { method: "PATCH" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        message.error(json?.error ?? "恢复失败")
        return
      }
      const impact = json?.data?.impact as Impact | undefined
      message.success(
        impact && (impact.lessons || impact.sentences)
          ? `已恢复（含 ${impact.lessons} 个课时、${impact.sentences} 条句子）`
          : "已恢复",
      )
      onDone()
    } catch {
      message.error("恢复失败")
    } finally {
      setBusy(false)
    }
  }

  if (isDeleted) {
    return (
      <Button
        size={size}
        icon={<UndoOutlined />}
        loading={busy}
        onClick={doRestore}
      >
        恢复
      </Button>
    )
  }

  return (
    <Button
      size={size}
      danger
      icon={<DeleteOutlined />}
      loading={busy}
      onClick={confirmDelete}
    >
      删除
    </Button>
  )
}
