import type { Metadata } from "next"
import { StoreClient } from "@/components/home/store/StoreClient"
import { BRAND } from "@/lib/brand"
import "./store-market.css"

/**
 * 课程广场 —— 基准实现 课程市场页 的对齐。
 *
 * 版式（hero + 搜索框、两级筛选标签、16:9 卡片网格、提示条）来自归档的
 * market.css；样式由 scripts/extract-store-market-css.py 生成，
 * 收敛在根节点的 `.store-market-page` 下，请勿手改。
 */
export const metadata: Metadata = {
  title: `课程广场 - ${BRAND.nameZh}`,
}

export default function StorePage() {
  return <StoreClient />
}
