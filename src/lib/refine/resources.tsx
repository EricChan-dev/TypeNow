import type { IResourceItem } from "@refinedev/core"
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  DollarOutlined,
  CrownOutlined,
  SettingOutlined,
  BarChartOutlined,
  BookOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from "@ant-design/icons"

export const resources: IResourceItem[] = [
  {
    name: "dashboard",
    list: "/admin",
    meta: { label: "仪表盘", icon: <DashboardOutlined /> },
  },
  {
    name: "courses",
    list: "/admin/courses",
    create: "/admin/courses/new",
    edit: "/admin/courses/:id/edit",
    meta: { label: "课程管理", icon: <BookOutlined /> },
  },
  {
    name: "lessons",
    list: "/admin/lessons",
    create: "/admin/lessons/new",
    edit: "/admin/lessons/:id/edit",
    meta: { label: "课时管理", icon: <UnorderedListOutlined /> },
  },
  {
    name: "sentences",
    list: "/admin/sentences",
    create: "/admin/sentences/new",
    edit: "/admin/sentences/:id/edit",
    meta: { label: "句子管理", icon: <FileTextOutlined /> },
  },
  {
    name: "materials",
    list: "/admin/materials",
    meta: { label: "教材导入", icon: <UploadOutlined /> },
  },
  {
    name: "users",
    list: "/admin/users",
    show: "/admin/users/:id",
    meta: { label: "用户管理", icon: <UserOutlined /> },
  },
  {
    name: "payment-orders",
    list: "/admin/payments",
    meta: { label: "支付订单", icon: <DollarOutlined /> },
  },
  {
    name: "subscriptions",
    list: "/admin/subscriptions",
    meta: { label: "订阅管理", icon: <CrownOutlined /> },
  },
  {
    name: "site-config",
    list: "/admin/pricing",
    meta: { label: "定价配置", icon: <SettingOutlined /> },
  },
  {
    name: "analytics",
    list: "/admin/analytics",
    meta: { label: "数据分析", icon: <BarChartOutlined /> },
  },
]
