/**
 * 账号注销的规则与清空清单（src/lib/account-deletion.ts）。
 *
 * 这里守的是两件事：
 *   1. **该清的必须清干净。** 手机号与微信 openid 是 UNIQUE，漏清一个，
 *      同一个人就再也注册不回来（注册走 find-or-create 会复用这条已注销的记录）；
 *      token 漏清则等于留了一把能代表该用户调微信接口的钥匙。
 *   2. **该拦的必须拦住。** 有未结佣金的合伙人注销后，partner_id 会变成一个
 *      再也没人能登录的内部 id，钱会永久卡死。
 *
 * 顺带用源码断言钉住「隐私政策的表述必须与实现一致」——
 * 这一处最容易再次漂移成"文案承诺删除全部数据、实现只清了手机号"。
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  DELETED_USER_NAME,
  DELETION_CONFIRM_PHRASE,
  USER_CONTENT_TABLES,
  anonymizedProfile,
  decideAccountDeletion,
  isConfirmPhraseValid,
} from "@/lib/account-deletion"

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("anonymizedProfile · 必须清空的账户信息", () => {
  const profile = anonymizedProfile()

  it("直接标识全部清空（手机号/邮箱/微信的 openid 与 unionid/昵称/头像）", () => {
    for (const key of [
      "phone",
      "email",
      "avatar",
      "wechatOpenid",
      "wechatUnionid",
    ] as const) {
      expect(profile[key]).toBeNull()
    }
    // 昵称不置 NULL 而是占位名：后台列表需要能看出这是"已注销"而不是坏数据
    expect(profile.name).toBe(DELETED_USER_NAME)
  })

  it("微信凭据全部清空（否则等于留了一把代表该用户调微信接口的钥匙）", () => {
    expect(profile.wechatAccessToken).toBeNull()
    expect(profile.wechatRefreshToken).toBeNull()
    expect(profile.wechatTokenExpiresAt).toBeNull()
  })

  it("邀请码与归因关系清空（手机号/openid 清了之后它们已无意义，留着只是个人信息）", () => {
    expect(profile.inviteCode).toBeNull()
    expect(profile.referredBy).toBeNull()
    expect(profile.referralLockedUntil).toBeNull()
  })

  it("signup_source 清空（含 IP/UA/referrer），但渠道标签保留用于渠道统计", () => {
    expect(profile.signupSource).toBeNull()
    // signupChannel 不在清空清单里 —— 它只是"从哪个入口来"的分类，不含可识别信息
    expect(Object.keys(profile)).not.toContain("signupChannel")
  })

  it("权益与资产归零，合伙人身份摘掉", () => {
    expect(profile.isPro).toBe(0)
    expect(profile.proExpires).toBeNull()
    expect(profile.diamonds).toBe(0)
    expect(profile.isPartner).toBe(0)
    expect(profile.partnerAgreedAt).toBeNull()
  })

  it("管理员身份必须摘掉（手机号清空后后台入口已不可用，留着只会造成困惑）", () => {
    expect(profile.role).toBe("user")
  })

  it("不清空内部主键与创建时间（历史与统计要用，且不指向自然人）", () => {
    expect(Object.keys(profile)).not.toContain("id")
    expect(Object.keys(profile)).not.toContain("createdAt")
    expect(Object.keys(profile)).not.toContain("level")
    expect(Object.keys(profile)).not.toContain("totalScore")
  })
})

describe("USER_CONTENT_TABLES", () => {
  it("包含用户自有的内容表（生词本与笔记）", () => {
    expect(Array.from(USER_CONTENT_TABLES)).toEqual(["user_notes", "wordbook_items"])
  })
})

describe("decideAccountDeletion · 该拦的必须拦住", () => {
  const base = {
    role: "user",
    isPartner: false,
    unsettledCommissionCount: 0,
    inFlightWithdrawalCount: 0,
  }

  it("普通用户放行", () => {
    expect(decideAccountDeletion(base).blocked).toBe(false)
  })

  it("管理员拦下（清空手机号会同时失去后台入口，需人工处理）", () => {
    const d = decideAccountDeletion({ ...base, role: "admin" })
    expect(d.blocked).toBe(true)
    expect(d.reason).toContain("管理员")
  })

  it("有未结佣金的合伙人拦下 —— 否则钱会永久卡在一个没人能登录的 id 上", () => {
    const d = decideAccountDeletion({ ...base, isPartner: true, unsettledCommissionCount: 1 })
    expect(d.blocked).toBe(true)
    expect(d.reason).toContain("佣金")
  })

  it("有在途提现拦下（转账在路上，注销会让对账无从进行）", () => {
    const d = decideAccountDeletion({ ...base, isPartner: true, inFlightWithdrawalCount: 1 })
    expect(d.blocked).toBe(true)
    expect(d.reason).toContain("提现")
  })

  it("管理员判定优先于资金判定（先给最需要人工介入的原因）", () => {
    const d = decideAccountDeletion({
      ...base,
      role: "admin",
      isPartner: true,
      unsettledCommissionCount: 3,
      inFlightWithdrawalCount: 2,
    })
    expect(d.reason).toContain("管理员")
  })

  it("已结清（clawed_back/withdrawn 不计入）的合伙人可以注销", () => {
    expect(
      decideAccountDeletion({ ...base, isPartner: true, unsettledCommissionCount: 0 }).blocked,
    ).toBe(false)
  })
})

describe("isConfirmPhraseValid", () => {
  it("必须与确认词完全一致（首尾空白容忍）", () => {
    expect(isConfirmPhraseValid(DELETION_CONFIRM_PHRASE)).toBe(true)
    expect(isConfirmPhraseValid(`  ${DELETION_CONFIRM_PHRASE}  `)).toBe(true)
  })

  it("其它输入一律拒绝（含错别字、内部空格、空值与非字符串）", () => {
    // 注意：首尾空白是**允许**的（见上一条），所以这里不能放 "注销账号 " 这种
    // 只差尾空格的值 —— trim 之后它本来就是合法的。
    for (const bad of ["注销", "注销 账号", "确认注销", "", "   ", null, undefined, 123, {}, []]) {
      expect(isConfirmPhraseValid(bad)).toBe(false)
    }
  })
})

describe("源码约束：实现与隐私政策必须一致", () => {
  const route = stripComments(read("src/app/api/user/delete/route.ts"))

  it("注销时删除全部会话（否则别的设备还留着有效会话）", () => {
    expect(route).toContain("delete(sessions)")
  })

  it("注销时按手机号删除验证码记录（该表含手机号与 IP，属于个人信息）", () => {
    expect(route).toContain("verificationCodes")
    expect(route).toContain("me.phone")
  })

  it("注销时删除用户自有内容", () => {
    expect(route).toContain("delete(userNotes)")
    expect(route).toContain("delete(wordbookItems)")
  })

  it("清空账户信息这一步放在最后（前面几步还要用到手机号）", () => {
    const clearIdx = route.indexOf("anonymizedProfile()")
    const codeIdx = route.indexOf("verificationCodes")
    expect(codeIdx).toBeGreaterThan(-1)
    expect(clearIdx).toBeGreaterThan(codeIdx)
  })

  it("隐私政策写明可自助注销，且如实说明「保留去标识化的历史数据」", () => {
    const privacy = read("src/app/(public)/privacy/page.tsx")
    expect(privacy).toContain("自助注销")
    expect(privacy).toContain("去除身份关联后保留")
    // 不能再出现"删除您的所有个人数据"这种与实现不符的绝对表述
    expect(privacy).not.toContain("删除您的所有个人数据")
  })

  it("设置页有自助入口，不再让用户「联系客服」", () => {
    const settings = read("src/components/home/SettingsClient.tsx")
    expect(settings).toContain("/api/user/delete")
    expect(settings).toContain("DELETION_CONFIRM_PHRASE")
    expect(settings).not.toContain("如需注销账号，请联系客服")
  })
})
