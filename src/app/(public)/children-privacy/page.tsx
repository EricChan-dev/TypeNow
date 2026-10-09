import type { Metadata } from "next"
import Link from "next/link"
import { BRAND, brandLockupWithEn } from "@/lib/brand"

export const metadata: Metadata = {
  title: `儿童隐私保护政策 - ${BRAND.nameZh}`,
  description: `${BRAND.nameZh}（${BRAND.nameEn}）针对未满 14 周岁儿童个人信息保护的专项说明，与《隐私政策》配套适用。`,
}

/**
 * 儿童隐私保护政策（独立页）。
 *
 * ── 为什么要单独开一页 ────────────────────────────────────────────────────
 *
 * 在此之前，本站关于儿童个人信息保护的全部内容只有《隐私政策》第 7 节的一句话
 * （「本服务主要面向成年人……如果您未满 14 周岁，请在监护人陪同下阅读本政策」）。
 * 而登录页的勾选条款与落地页页脚都摆着第三个链接「《儿童隐私保护政策》」，
 * 实际却只能 `#minors` 跳到那一句话上 —— 链接文字承诺了一份独立文件，
 * 落点却是一段摘要，这个落差本身就是合规风险。
 *
 * 依据是《个人信息保护法》第三十一条与《儿童个人信息网络保护规定》：
 * 处理不满十四周岁未成年人个人信息，应当取得其父母或其他监护人的**单独同意**，
 * 并**制定专门的个人信息处理规则**。「专门的规则」不能靠《隐私政策》里的一节
 * 来凑 —— 这也正是本文件独立存在的原因。
 *
 * ── 写这份文本时守的两条底线 ──────────────────────────────────────────────
 *
 *   1. **不写做不到的承诺。** 本站目前**没有**年龄识别或监护人验证环节
 *      （代码里没有任何出生日期/年龄字段，也没有年龄门）。因此这份政策如实写成
 *      「本服务不面向未满 14 周岁儿童、不主动收集其信息；一旦发现即删除」，
 *      而不是假装我们有一套「监护人明示同意」的流程 —— 写了却做不到，
 *      在监管口径里比不写更严重。
 *   2. **口径与实现一致。** 注销范围那段必须与 lib/account-deletion.ts 的字段
 *      清空清单、以及设置页注销弹窗的措辞逐条对得上，三处不能各说各话。
 */
export default function ChildrenPrivacyPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight mb-2">儿童隐私保护政策</h1>
      <p className="text-sm text-muted-foreground mb-10">
        更新日期：2026 年 10 月 9 日 &middot; 生效日期：2026 年 10 月 9 日
      </p>

      <div className="prose prose-slate max-w-none space-y-6 text-sm leading-relaxed">
        <p>
          本政策是 {BRAND.nameZh}（{BRAND.nameEn}，以下简称「本服务」）就<strong>未满 14 周岁儿童</strong>
          个人信息保护作出的专门说明，是《隐私政策》的组成部分。本政策与
          <Link href="/privacy" className="text-[#1E40AF] hover:underline mx-0.5">
            《隐私政策》
          </Link>
          不一致的，涉及儿童个人信息的部分以本政策为准。
        </p>

        {/* 与《隐私政策》《用户协议》保持同一套更名连续性口径 */}
        <p className="rounded-lg border border-border bg-muted px-4 py-3 text-[13px] text-muted-foreground">
          <strong>关于品牌更名：</strong>本服务原名「码上英语」，自 2026 年 10 月 8 日起更名为「{BRAND.nameZh}」，
          英文名 {BRAND.nameEn} 保持不变。更名不影响我们对儿童个人信息保护责任的连续性，
          {brandLockupWithEn()} 运营主体承担同等保护义务。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">1. 本服务的适用人群</h2>
        <p>
          本服务是一款面向<strong>成年人</strong>的 AI 中译英打字练习工具，练习内容涉及语法结构、
          句子听写与 AI 讲解，<strong>不以未满 14 周岁的儿童为目标用户</strong>，也不针对儿童设计功能或内容。
        </p>
        <p>
          我们<strong>不会主动收集</strong>未满 14 周岁儿童的个人信息，也不会有意引导儿童注册使用。
          我们<strong>不建议</strong>未满 14 周岁的儿童自行注册本服务；如确有学习需要，
          请由其父母或其他监护人以<strong>成年人本人的名义</strong>注册并全程陪同使用，
          由监护人对其账号下发生的一切行为负责。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">2. 关于监护人单独同意的说明</h2>
        <p>
          依照《个人信息保护法》第三十一条与《儿童个人信息网络保护规定》，
          处理未满 14 周岁儿童的个人信息应当取得其父母或其他监护人的<strong>单独同意</strong>。
        </p>
        {/* 这一节是全篇最需要诚实的地方：没有年龄门，就不要假装有审批流程。 */}
        <p>
          <strong>我们需要如实向您说明当前的实现边界：</strong>本服务目前<strong>没有设置年龄识别环节</strong>，
          也不会在注册时要求填写出生日期或验证监护人身份。因此，我们无法在技术上区分
          「成年人本人注册」与「儿童使用成年人账号」这两种情况 —— 后一种情形下的同意，
          是由提供账号的监护人以注册并同意本政策的方式作出的。
        </p>
        <p>
          如果您是监护人，请勿将您的账号交由未满 14 周岁的儿童独立使用；
          如您决定陪同儿童使用，即视为您已阅读并同意本政策，并同意我们在提供服务所必需的范围内
          处理该账号产生的练习数据。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">3. 我们会处理哪些信息</h2>
        <p>
          本服务不设独立的「儿童账号」，因此不存在一套只针对儿童收集的信息类型。
          账号项下可能处理的信息与《隐私政策》所述一致，主要包括：
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>账号信息：</strong>手机号码，或微信登录时的 OpenID 与头像昵称。</li>
          <li>
            <strong>练习数据：</strong>打字内容、正确率、速度、连击数、错误记录等学习行为数据。
            这些数据用于生成学习统计与智能复习安排。
          </li>
          <li><strong>设备与日志信息：</strong>浏览器类型、操作系统、IP 地址、访问时间等，用于服务稳定性与安全防护。</li>
          <li>
            <strong>客服沟通内容：</strong>当您通过公众号或反馈入口联系我们时，您主动提供的文字与图片。
          </li>
        </ul>
        <p className="mt-3">
          我们<strong>不收集</strong>儿童的地理位置、通讯录、相册、麦克风与摄像头等敏感权限信息，
          也<strong>不会</strong>将所收集的信息用于个性化广告推送或与儿童相关的商业营销。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">4. 信息的使用目的与限制</h2>
        <p>账号项下的信息仅用于以下目的：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>提供打字练习、智能复习、学习统计等核心功能；</li>
          <li>保障账号安全，识别与防范异常登录；</li>
          <li>向账号持有人发送与会员到期、学习进度相关的<strong>服务通知</strong>（不含促销与营销内容）。</li>
        </ul>
        <p className="mt-3">
          我们<strong>不会</strong>将儿童个人信息用于用户画像、定向推送或自动化决策，
          也<strong>不会</strong>将其用于与上述目的无关的用途。如需超出上述范围使用，我们会再次征得监护人同意。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">5. 信息的存储与保护</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            账号信息存储在我们自有的服务器上（阿里云，服务器位于<strong>中国大陆境内</strong>），
            不会出境存储，也不使用境外云数据库服务。
          </li>
          <li>我们采取业界通行的安全措施，包括但不限于数据加密传输（HTTPS）、访问权限控制与定期安全审计。</li>
          <li>
            我们对内部人员的访问实行<strong>最小必要</strong>原则：仅经授权且确有必要的工作人员在履行职责时
            方可接触相关信息（如为排查故障查看 AI 对话内容），并受保密义务约束。
          </li>
          <li>
            我们仅在实现处理目的所必需的<strong>最短期限</strong>内保存儿童个人信息；
            超出保存期限或处理目的已实现的，我们会予以删除或匿名化处理。
          </li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">6. 信息的共享与披露</h2>
        <p>
          我们<strong>不会</strong>出售儿童个人信息。仅在以下必要情形下共享，且共享范围以最小必要为限：
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>微信开放平台：</strong>使用微信扫码登录时，微信会按其隐私政策处理相关数据。
          </li>
          <li>
            <strong>阿里云短信：</strong>发送手机验证码时，我们会向阿里云短信服务提供该手机号。
          </li>
          <li>
            <strong>法律要求：</strong>根据法律法规、法院命令或政府机关的强制要求披露信息。
          </li>
        </ul>
        <p className="mt-3">
          除上述情形外，我们不会向任何第三方提供儿童个人信息。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">7. 监护人的权利</h2>
        <p>父母或其他监护人有权随时查阅、更正、删除其账号项下的个人信息。具体方式：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>查阅与更正：</strong>可在应用内「设置」页面查看与修改手机号、昵称、头像等信息。
          </li>
          <li>
            <strong>删除与注销：</strong>可在「设置 → 账号安全」中<strong>自助注销</strong>账号，无需联系客服。
            注销时会<strong>清空</strong>手机号、邮箱、微信绑定、昵称、头像与邀请码，
            <strong>删除</strong>生词本与句子笔记，并退出全部设备的登录。
            练习记录、打卡、钻石、金币与订单等历史数据会<strong>去除身份关联后保留</strong>，
            用于学习统计与财务凭证，这部分数据不再能够指向任何个人。注销不可恢复。
          </li>
          <li>
            <strong>撤回同意：</strong>监护人可随时通过注销账号或停止使用服务，撤回对信息处理的同意。
          </li>
          <li>
            <strong>投诉与咨询：</strong>如对本政策或儿童个人信息处理有任何疑问，
            可通过本政策第 9 节的方式联系我们，我们将在 15 个工作日内回复。
          </li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">8. 发现儿童信息时的处理</h2>
        <p>
          如果我们发现在未取得监护人同意的情况下收集了未满 14 周岁儿童的个人信息，
          我们会<strong>立即停止处理</strong>，并在核实后<strong>尽快删除</strong>相关信息；
          无法删除的，我们会进行匿名化处理。
        </p>
        <p className="mt-3">
          如果您是监护人，发现您的孩子未经您同意使用了本服务，或您希望我们删除相关信息，
          请通过第 9 节的方式与我们联系，或直接使用账号的<strong>自助注销</strong>功能。
          我们将在核实身份后及时处理。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">9. 如何联系我们</h2>
        <p>
          如果您对本政策或儿童个人信息保护有任何疑问、意见或投诉，请通过以下方式联系我们：
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>网站：typenow.cn</li>
          <li>微信公众号：关注「{BRAND.lockup}」后直接在公众号内发消息说明情况。</li>
          <li>我们将在收到您的请求后 15 个工作日内予以回复。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">10. 本政策的更新</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>我们可能会不时更新本政策。更新后的政策将在本页面发布，并标注更新日期。</li>
          <li>
            对于涉及儿童个人信息处理方式、范围或目的的<strong>重大变更</strong>，
            我们将通过产品内通知或其他合理方式告知监护人。
          </li>
          <li>如您在本政策更新后继续使用本服务，即表示您接受更新后的政策。</li>
        </ul>

        <p className="mt-10 text-muted-foreground">
          感谢您对 {BRAND.nameZh} 的信任。我们将持续重视并保护未成年人个人信息安全。
        </p>
      </div>
    </div>
  )
}
