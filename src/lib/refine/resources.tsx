import type { IResourceItem } from "@refinedev/core"
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  DollarOutlined,
  CrownOutlined,
  BarChartOutlined,
  BookOutlined,
  UnorderedListOutlined,
  UploadOutlined,
  LineChartOutlined,
  ThunderboltOutlined,
  MessageOutlined,
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
    name: "practice-records",
    list: "/admin/practice",
    // 只读：练习记录是用户行为的历史事实，后台不应该能改
    meta: { label: "练习记录", icon: <ThunderboltOutlined /> },
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
    name: "feedback",
    list: "/admin/feedback",
    meta: { label: "反馈管理", icon: <MessageOutlined /> },
  },
  {
    name: "analytics",
    list: "/admin/analytics",
    meta: { label: "数据分析", icon: <BarChartOutlined /> },
  },
  {
    name: "events",
    list: "/admin/events",
    // 详情页是 /admin/events/:id，但这里不声明 show：
    // 该页不是 refine 的 Show（自己 fetch 带上下文），声明了反而会让
    // refine 在菜单里生成一个用不到的入口
    meta: { label: "埋点分析", icon: <LineChartOutlined /> },
  },
]
