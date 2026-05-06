import type { IResourceItem } from "@refinedev/core"
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  DollarOutlined,
  CrownOutlined,
  SettingOutlined,
  BarChartOutlined,
} from "@ant-design/icons"

export const resources: IResourceItem[] = [
  {
    name: "dashboard",
    list: "/admin",
    meta: { label: "仪表盘", icon: <DashboardOutlined /> },
  },
  {
    name: "sentences",
    list: "/admin/sentences",
    create: "/admin/sentences/new",
    edit: "/admin/sentences/:id/edit",
    meta: { label: "句子管理", icon: <FileTextOutlined /> },
  },
  {
    name: "users",
    list: "/admin/users",
    show: "/admin/users/:id",
    meta: { label: "用户管理", icon: <UserOutlined /> },
  },
  {
    name: "payment_orders",
    list: "/admin/payments",
    meta: { label: "支付订单", icon: <DollarOutlined /> },
  },
  {
    name: "subscriptions",
    list: "/admin/subscriptions",
    meta: { label: "订阅管理", icon: <CrownOutlined /> },
  },
  {
    name: "pricing",
    list: "/admin/pricing",
    meta: { label: "定价配置", icon: <SettingOutlined /> },
  },
  {
    name: "analytics",
    list: "/admin/analytics",
    meta: { label: "数据分析", icon: <BarChartOutlined /> },
  },
]
