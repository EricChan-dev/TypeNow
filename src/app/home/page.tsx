import { HomeClient } from "@/components/home/HomeClient"

export default async function HomePage() {
  // 昵称不再从服务端透传：顶部问候语已移除，会员卡自己从 /api/auth/me 取。
  return <HomeClient />
}
