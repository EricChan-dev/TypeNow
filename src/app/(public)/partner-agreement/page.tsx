import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "合伙人推广合作协议 - TypeNow",
}

export default function PartnerAgreementPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight mb-2">码上英语合伙人推广合作协议</h1>
      <p className="text-sm text-muted-foreground mb-10">
        更新日期：2026 年 5 月 27 日 &middot; 生效日期：2026 年 5 月 27 日
      </p>

      <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
        <p>
          本协议由合伙人（以下简称「您」或「推广方」）与 TypeNow（码上英语）运营方（以下简称「平台方」或「我们」）共同缔结。
          您在平台完成合伙人开通操作并支付合伙人会员费用即视为已阅读、理解并同意本协议的全部内容。
          本协议自您开通合伙人资格之日起生效。
        </p>

        <h2 className="text-lg font-semibold mt-10 mb-3">第一条　合作性质</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            本协议项下的合作关系为<strong>单级推广合作</strong>，即您（合伙人）通过专属邀请链接向第三方用户推荐 TypeNow 平台，被推荐用户付费后您可获得相应佣金。
          </li>
          <li>
            本合作<strong>不构成任何形式的多层分销或传销</strong>。当被邀请用户 B 进一步邀请用户 C 时，您（A）不从 C 的付款中获得任何收益；仅 B（若其本身也是合伙人）可从 C 处获益。
          </li>
          <li>
            您与平台方之间不存在劳动或雇佣关系，合伙人资格不赋予您代表平台方签署任何协议、收取款项或承担任何法律义务的权利。
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-10 mb-3">第二条　推广规则</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>专属邀请码：</strong>开通合伙人资格后，平台将为您生成唯一专属邀请码及邀请链接。您可通过链接、二维码或海报等方式推广，被邀请用户须通过您的专属链接注册方视为有效归因。
          </li>
          <li>
            <strong>归因规则：</strong>用户首次通过您的邀请链接访问并注册账号时，平台写入归因记录，归因关系一经确立不可修改。
          </li>
          <li>
            <strong>90 天归因窗口：</strong>佣金仅在被邀请用户<strong>注册后 90 天内</strong>完成首次付款时触发。90 天后的付款属于用户自由付费行为，不再与推广方产生佣金关系。
          </li>
          <li>
            <strong>禁止行为：</strong>您不得通过以下方式推广，否则平台有权撤销相关佣金并封禁账号：
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>虚假宣传、夸大收益或误导性描述平台功能；</li>
              <li>使用垃圾邮件、批量短信、自动化程序等方式发送推广内容；</li>
              <li>通过自注册、刷单或关联账号等方式套取佣金；</li>
              <li>购买或使用他人邀请链接进行自我注册；</li>
              <li>在平台明确禁止的渠道发布推广内容（如竞品论坛恶意引流等）。</li>
            </ul>
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-10 mb-3">第三条　佣金结算</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>佣金比例：</strong>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>被邀请用户在注册后 <strong>90 天内首次付款</strong>：佣金为订单实付金额的 <strong>50%</strong>；</li>
              <li>被邀请用户在注册后 <strong>90 天内续费</strong>：佣金为订单实付金额的 <strong>30%</strong>；</li>
              <li>90 天归因窗口外的付款（含续费）：<strong>不产生佣金</strong>；</li>
              <li>合伙人本人购买的任何套餐不产生自我佣金。</li>
            </ul>
          </li>
          <li>
            <strong>冷静期：</strong>每笔订单产生的佣金进入 <strong>15 天冷静期</strong>，期间如发生退款，对应佣金将直接撤销（状态变为「已回扣」）。冷静期结束且无退款，佣金自动变为「可提现」状态。
          </li>
          <li>
            <strong>提现规则：</strong>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>最低提现金额为 <strong>¥50</strong>，可随时发起提现申请；</li>
              <li>提现通道为<strong>微信商家转账</strong>，款项实时到账至您绑定的微信账号零钱；</li>
              <li>您可在微信中自行将零钱提现至银行卡，平台不介入银行卡信息；</li>
              <li>提现前须在「个人设置」中完成微信账号绑定以获取 OpenID；</li>
              <li>因用户本人原因（如微信账号异常、OpenID 失效等）导致的提现失败，请联系客服处理。</li>
            </ul>
          </li>
          <li>
            <strong>退款回扣：</strong>若被邀请用户发生退款且对应佣金已处于「可提现」状态，平台将从您的可提现余额中扣除等额佣金。若余额不足，平台将暂停您的提现权限，直至补齐差额或人工核查处理完毕。若佣金已提现，平台将通过书面通知方式向您追讨。
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-10 mb-3">第四条　合伙人资格管理</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>开通条件：</strong>支付 <strong>¥399 一次性合伙人会员费</strong>，并同意本协议，即可开通合伙人资格。合伙人同时享有平台全部会员功能，永久有效。
          </li>
          <li>
            <strong>资格终止：</strong>如您严重违反本协议条款，平台有权在不退还合伙人费用的情况下，撤销您的推广资格，并拒绝结算冷静期内尚未生效的佣金。已结算完成的佣金不受影响。
          </li>
          <li>
            <strong>账号封禁：</strong>经核查确认存在刷单、虚假注册等恶意行为的，平台有权直接封禁账号，所有未结佣金视为无效，且不予退款。
          </li>
          <li>
            合伙人资格与账号绑定，不可转让或出售。
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-10 mb-3">第五条　双方权利与义务</h2>
        <p className="font-medium">推广方（您）的义务：</p>
        <ul className="list-disc pl-5 space-y-2 mt-2">
          <li>遵守国家有关互联网营销、广告发布的相关法律法规；</li>
          <li>如实、客观地介绍平台功能与服务，不得夸大宣传；</li>
          <li>保护被邀请用户的个人信息，不得非法收集或传播；</li>
          <li>对自身推广行为产生的法律责任承担连带义务。</li>
        </ul>
        <p className="font-medium mt-4">平台方（我们）的义务：</p>
        <ul className="list-disc pl-5 space-y-2 mt-2">
          <li>按本协议约定准确核算并展示您的佣金数据；</li>
          <li>在冷静期结束、无退款后及时将佣金更新为「可提现」状态；</li>
          <li>在您发起提现后及时处理并转账（通常为实时，最长不超过 3 个工作日）；</li>
          <li>如因平台系统故障导致佣金计算错误，负责核查并补偿差额；</li>
          <li>保护您的推广数据及个人信息，不向第三方出售。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-10 mb-3">第六条　合规与风险提示</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            本合作遵循<strong>单级分销</strong>模式，严格符合《禁止传销条例》的相关规定。推广方不得以任何方式组织多层级团队或收取下线加盟费用。
          </li>
          <li>
            佣金收入属于个人劳务或经营所得，您应依法向相关税务机关申报纳税。平台不承担代扣代缴义务，但如法规有强制要求，平台将配合执行。
          </li>
          <li>
            平台有权建立风控系统对推广行为进行监测，包括但不限于 IP 检测、注册频率分析等。异常数据将触发人工核查，期间相关佣金暂缓结算。
          </li>
          <li>
            平台保留在不提前通知的情况下调整佣金比例或规则的权利，但调整不追溯影响已生效（冷静期结束）的历史佣金。如佣金规则发生重大变更，平台将提前 7 日以站内通知或邮件方式告知。
          </li>
        </ol>

        <h2 className="text-lg font-semibold mt-10 mb-3">第七条　附则</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            本协议受中华人民共和国法律管辖。如发生争议，双方应首先协商解决；协商不成的，提交平台运营主体所在地有管辖权的法院诉讼解决。
          </li>
          <li>
            本协议条款如与平台其他规则（如《用户协议》《隐私政策》）存在冲突，以本协议为准（仅限合伙人相关事项）。
          </li>
          <li>
            平台方保留对本协议的最终解释权，如有修订，将在平台官网公告，修订后继续使用合伙人功能即视为同意新协议。
          </li>
          <li>
            如有任何疑问，请通过平台客服渠道联系我们。
          </li>
        </ol>
      </div>
    </div>
  )
}
