import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "用户协议 - TypeNow",
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight mb-2">用户协议</h1>
      <p className="text-sm text-muted-foreground mb-10">
        更新日期：2026 年 5 月 1 日 &middot; 生效日期：2026 年 5 月 1 日
      </p>

      <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
        <p>
          欢迎使用 TypeNow（码上英语）及相关服务（以下简称「本服务」）。本协议由您（以下简称「用户」）与 TypeNow 运营方（以下简称「我们」）共同缔结。请您务必审慎阅读并充分理解本协议各条款内容，特别是免除或限制责任的条款。您使用本服务即表示您已阅读、理解并同意接受本协议的全部内容。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">1. 服务说明</h2>
        <p>
          TypeNow 是一款 AI 驱动的中译英打字练习平台，提供包括但不限于打字练习、智能复习、AI
          强化训练等功能。我们保留随时修改、暂停或终止部分或全部服务的权利，且无需事先通知用户。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">2. 用户注册与账号</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>用户可通过微信扫码或手机号验证码方式注册并登录本服务。</li>
          <li>用户应提供真实、准确的手机号信息，并对其账号安全负责，包括但不限于妥善保管验证码。</li>
          <li>用户账号仅限本人使用，不得出借、转让或与他人共享。因账号保管不善导致的损失由用户自行承担。</li>
          <li>我们有权在发现异常登录或违规行为时，暂时冻结或永久封禁相关账号。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">3. 用户行为规范</h2>
        <p>用户在使用本服务过程中，不得从事以下行为：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>发布、传播违反中华人民共和国法律法规的内容；</li>
          <li>利用技术手段恶意攻击、干扰或破坏本服务的正常运行；</li>
          <li>利用本服务进行任何形式的作弊、刷分、数据造假等行为；</li>
          <li>反向工程、破解或以其他方式获取本服务的源代码；</li>
          <li>利用本服务进行商业广告或未经授权的商业推广。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">4. 知识产权</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>本服务包含的所有内容，包括但不限于文字、图片、音频、视频、软件、代码、界面设计等，其知识产权归我们或相关权利人所有。</li>
          <li>用户在使用本服务过程中产生的内容（如练习记录、分数等），其数据所有权归用户所有，用户授予我们在提供服务所必需的范围内使用该等数据的权利。</li>
          <li>未经我们书面许可，任何人不得以任何方式复制、修改、传播、出版或用于商业目的。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">5. 付费服务</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>本服务部分高级功能（如 AI 强化训练）为付费服务，具体定价以产品内公布的为准。</li>
          <li>付费服务的费用一经支付，除法律法规另有规定外，不予退还。</li>
          <li>我们保留根据运营需要调整定价的权利，价格调整前已购买的服务不受影响。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">6. 免责声明</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>本服务按「现状」提供，我们不保证服务完全无错误、无中断或满足用户的所有期望。</li>
          <li>AI 生成的内容仅供参考，不构成任何形式的专业建议。用户应独立判断其准确性和适用性。</li>
          <li>因不可抗力、系统维护、网络故障等原因导致的服务中断，我们不承担责任，但将尽力及时修复。</li>
          <li>对于用户因使用本服务而产生的任何间接损失（如数据丢失、学习效果不佳等），我们不承担责任。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">7. 服务变更与终止</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>我们有权根据业务发展需要，变更、暂停或终止本服务的全部或部分内容。</li>
          <li>如用户违反本协议，我们有权立即终止向该用户提供服务，且无需退还任何费用。</li>
          <li>用户可随时停止使用本服务，已产生的数据将按隐私政策处理。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">8. 法律适用与争议解决</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>本协议的订立、执行和解释均适用中华人民共和国法律。</li>
          <li>因本协议产生的争议，双方应友好协商解决；协商不成的，任何一方均可向我们所在地有管辖权的人民法院提起诉讼。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">9. 其他</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>本协议中的任何条款无论因何种原因部分无效，其余条款仍有效并对双方具有约束力。</li>
          <li>我们有权根据需要更新本协议，更新后的协议一经发布即生效。重大变更我们将通过合理方式通知用户。</li>
        </ul>

        <p className="mt-10 text-muted-foreground">
          如您对本协议有任何疑问，请通过 typenow.cn 上的联系方式与我们联系。
        </p>
      </div>
    </div>
  )
}
