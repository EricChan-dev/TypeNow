import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "隐私政策 - TypeNow",
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight mb-2">隐私政策</h1>
      <p className="text-sm text-muted-foreground mb-10">
        更新日期：2026 年 5 月 1 日 &middot; 生效日期：2026 年 5 月 1 日
      </p>

      <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
        <p>
          我们深知个人信息对您的重要性。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。请您在使用 TypeNow（码上英语）服务前仔细阅读本政策。
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-3">1. 我们收集的信息</h2>

        <h3 className="text-base font-medium mt-6 mb-2">1.1 您主动提供的信息</h3>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>手机号码：</strong>用于账号注册、登录验证和账号安全保护。</li>
          <li><strong>微信账号信息：</strong>当您通过微信扫码登录时，我们会获取您的微信 OpenID 和头像昵称等基本信息。</li>
          <li><strong>用户反馈：</strong>当您联系客服或提交反馈时，我们会收集您主动提供的文字、图片等内容。</li>
        </ul>

        <h3 className="text-base font-medium mt-6 mb-2">1.2 使用过程中自动收集的信息</h3>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>练习数据：</strong>包括打字内容、正确率、速度、连击数、错误记录等学习行为数据，用于智能复习和 AI 强化训练。</li>
          <li><strong>设备信息：</strong>包括浏览器类型、操作系统版本、设备型号、屏幕分辨率等，用于优化产品体验。</li>
          <li><strong>日志信息：</strong>IP 地址、访问时间、访问页面、停留时长等，用于服务稳定性和安全防护。</li>
          <li><strong>Cookie：</strong>用于维持登录状态、记住用户偏好设置。您可通过浏览器设置管理 Cookie。</li>
        </ul>

        <h3 className="text-base font-medium mt-6 mb-2">1.3 第三方服务收集的信息</h3>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Supabase：</strong>我们使用 Supabase 作为后端数据服务，您的个人数据存储在 Supabase 服务器上。</li>
          <li><strong>微信开放平台：</strong>使用微信扫码登录时，微信会按其隐私政策处理相关数据。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">2. 信息的使用</h2>
        <p>我们收集的信息将用于以下目的：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>提供、维护和优化打字练习、智能复习、AI 训练等核心功能；</li>
          <li>分析学习数据，生成个性化学习报告和改进建议；</li>
          <li>保障账号安全，检测和防范异常登录及作弊行为；</li>
          <li>向您发送与产品相关的重要通知（如服务更新、活动信息等）；</li>
          <li>改进产品体验，进行数据分析和用户画像研究（以去标识化形式）。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">3. 信息的存储与保护</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>您的个人信息存储在 Supabase 提供的云服务器上，服务器可能位于中国大陆以外的地区。</li>
          <li>我们采取业界通行的安全措施保护您的信息，包括但不限于数据加密传输（HTTPS）、访问权限控制和定期安全审计。</li>
          <li>我们承诺在服务终止后，在合理期限内删除或匿名化处理您的个人信息，除非法律另有要求。</li>
          <li>尽管我们采取了合理的安全措施，但请注意互联网不存在绝对的安全，您应妥善保管账号和验证信息。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">4. 信息的共享与披露</h2>
        <p>我们不会将您的个人信息出售给任何第三方。我们仅在以下情况共享信息：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>经您同意：</strong>在获得您的明确同意后，我们会向第三方共享您的信息。</li>
          <li><strong>服务提供商：</strong>与为我们提供服务的第三方（如 Supabase、阿里云短信服务）共享必要的信息。</li>
          <li><strong>法律要求：</strong>根据法律法规、法院命令或政府机关的强制要求披露信息。</li>
          <li><strong>保护权益：</strong>为防止对他人人身或财产安全的威胁，或为保护我们的合法权益而必要的披露。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">5. 您的权利</h2>
        <p>根据适用法律，您对自己的个人信息享有以下权利：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>查阅与更正：</strong>您可以在个人设置页面查看和修改您的个人信息。</li>
          <li><strong>删除：</strong>您可以通过注销账号来删除您的所有个人数据。注销后数据不可恢复。</li>
          <li><strong>撤回同意：</strong>您可以通过退出登录或停止使用服务来撤回对信息收集的同意。</li>
          <li><strong>投诉：</strong>如您认为我们处理信息的方式侵犯了您的权益，您可以向相关监管部门投诉。</li>
          <li>如需行使上述权利，请通过 typenow.cn 上的联系方式联系我们，我们将在 15 个工作日内回复。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">6. Cookie 及同类技术</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>我们使用必要的 Cookie 以维持您的登录状态和偏好设置，这些 Cookie 是本服务正常运行所必需的。</li>
          <li>我们可能使用分析型 Cookie 来了解用户如何使用我们的产品，以改进服务体验。这些数据以匿名形式收集。</li>
          <li>您可以通过浏览器设置拒绝 Cookie，但可能导致部分功能无法正常使用。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">7. 未成年人保护</h2>
        <p>本服务主要面向成年人。如果您未满 14 周岁，请在监护人陪同下阅读本政策并取得监护人同意后再使用。我们会根据法律法规的要求保护未成年人的个人信息。</p>

        <h2 className="text-lg font-semibold mt-8 mb-3">8. 隐私政策的更新</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>我们可能会不时更新本隐私政策。更新后的政策将在本页面发布，并标注更新日期。</li>
          <li>对于重大变更，我们将通过产品内通知、短信或其他合理方式告知您。</li>
          <li>如您在政策更新后继续使用本服务，即表示您接受更新后的隐私政策。</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-3">9. 联系我们</h2>
        <p>如果您对本隐私政策或个人信息处理有任何疑问、意见或投诉，请通过以下方式联系我们：</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>网站：typenow.cn</li>
          <li>我们将在收到您的请求后 15 个工作日内予以回复。</li>
        </ul>

        <p className="mt-10 text-muted-foreground">
          感谢您信任并使用 TypeNow。我们将一如既往地重视并保护您的个人隐私。
        </p>
      </div>
    </div>
  )
}
