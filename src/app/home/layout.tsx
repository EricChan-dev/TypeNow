// 首页改版样式（对齐验收版式）。沿用登录页的先例（app/login/layout.tsx
// 导入 ./login.css）：全部规则挂在 `.home-ref` / `.home-ref-shell` 作用域下，
// 所以放在 /home 的 layout 里不会波及站内其它页面，也不需要额外包一层组件。
//
// 两个文件分工：
// · home-ref.css —— 内容区（`.home-ref` 作用域），对应 .bgwhite / .col3 等区块
// · home-shell.css —— 外框骨架（`.home-ref-shell` 作用域），对应
//                       .container-fuild / .sidebar-wrapper / .main-wrapper / .mainBox
import "./home-ref.css"
import "./home-shell.css"

import { redirect } from "next/navigation"
import { getUser, isDbConfigured } from "@/app/actions/auth"
import { isDevBypassSession } from "@/lib/auth/session"
import { needsPhoneBinding } from "@/lib/phone-gate"
import { getActiveSubscription } from "@/lib/subscription"
import { HomeShell } from "@/components/home/HomeShell"
import { ExpiryWarningModal } from "@/components/home/ExpiryWarningModal"
import { CHECK_IN_GOAL_DEFAULT } from "@/lib/coins"

export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const dbReady = await isDbConfigured()
  const user = await getUser()

  if (dbReady && !user) {
    redirect("/login")
  }

  // 微信登录建号时拿不到手机号，而手机号是唯一能把"微信注册的号"和"手机号注册的号"
  // 认成同一个人的凭据 —— 不强制绑定，同一个人就会有两个账号。
  //
  // 拦的方式从「盖一层不可关闭的弹窗」改成了**送去 /login?bind=1 完成绑定**
  // （用户 m03647：要的是"登录校验"，不是全局弹窗）。绑定本身复用登录页的
  // 「验证码登录」tab —— 用户在那里本来就会输手机号 + 验证码，不必再学一套 UI。
  //
  // 这道服务端跳转是**兜底**：主路径由微信回调自己判定（见 api/auth/wechat/callback
  // 与 api/auth/wechat/oa-check），正常情况下用户根本到不了 /home。留着它是因为
  // 用户可以直接敲 /home 地址进来，只靠回调判定会漏。
  //
  // 仍然拦在"进站之前"：这时微信壳账号还没有任何练习数据，撞号时只需把微信身份
  // 转到手机号账号上，不必做数据合并（系统没有那个能力）。见 lib/phone-gate。
  //
  // 注意这里**不能**改成渲染弹窗：那样页面会把 /home 的内容也渲染进响应，
  // 未绑定用户能顺手读到自己的学习数据。
  const mustBindPhone =
    !!user && needsPhoneBinding({ phone: user.phone, devBypass: await isDevBypassSession() })

  if (mustBindPhone) {
    redirect("/login?bind=1")
  }

  let memberTier: "trial" | "monthly" | "yearly" | "partner" | "free" = "free"
  if (user) {
    if (user.isPartner) {
      memberTier = "partner"
    } else if (user.isPro) {
      const sub = await getActiveSubscription(user.id)
      memberTier = (sub?.plan as "monthly" | "yearly") ?? "trial"
    }
  }

  const serverUser = user
    ? {
        name: user.name || null,
        avatar: user.avatar || null,
        email: user.email || null,
        is_pro: !!user.isPro,
        is_partner: !!user.isPartner,
        level: user.level,
        member_tier: memberTier,
        pro_expires: user.proExpires?.toISOString() ?? null,
        diamonds: user.diamonds ?? 0,
        coins: user.coins ?? 0,
        // 打卡目标＝当日练习句数（语义见 lib/coins.ts）。
        // 默认值必须与后端同源，否则「还没设置过目标的用户」在前端会看到一个
        // 与接口判定不一致的门槛。
        check_in_goal: user.checkInGoal ?? CHECK_IN_GOAL_DEFAULT,
      }
    : null

  // 不再包一层 flex 容器：外框根节点 `.home-ref-shell` 自己就是 100dvh 的固定外壳
 // （原版式 body 也是 overflow:hidden 的固定外壳）。多包一层只会让根布局的
  // `body.flex.flex-col` 参与进来，把 100dvh 撑成 100% + 兄弟节点高度。
  return (
    <>
      <HomeShell serverUser={serverUser}>{children}</HomeShell>
      {serverUser && (
        <ExpiryWarningModal
          memberTier={serverUser.member_tier}
          proExpires={serverUser.pro_expires}
        />
      )}
    </>
  )
}
