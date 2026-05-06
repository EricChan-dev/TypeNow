import { getUser } from "@/app/actions/auth"

export default async function HomePage() {
  const user = await getUser()
  const userName = user?.user_metadata?.name || user?.email?.split("@")[0] || "用户"

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground">
        欢迎回来，{userName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        继续你的英语学习之旅
      </p>
    </div>
  )
}
