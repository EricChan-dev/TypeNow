/**
 * 后台表格里的时间格式化。
 *
 * ── 为什么需要它（这一处真的错过，而且误导性极强）──────────────────────────
 *
 * 2026-09-29 有人在后台发现「练习时间早于注册时间」：
 *
 *     注册 2026-09-29 10:24:45，首次练习却显示 2026-09-29 02:55:26
 *
 * **数据本身没问题**：库里真实首次练习是 10:27:38，比注册晚 2 分 53 秒，
 * 顺序完全正常。错的是显示：接口返回的是 JS `Date`，经 JSON 序列化变成
 * **UTC** 的 ISO 串（`2026-09-29T02:27:38.000Z`），而前端写的是
 *
 *     String(v).replace("T", " ").slice(0, 19)
 *
 * 于是把 UTC 的钟点当成本地时间原样打了出来，整整早了 8 小时。
 *
 * 更麻烦的是同一批后台页面里还有另一种写法
 * `new Date(d).toLocaleString("zh-CN")` —— 那个是**对的**（会按浏览器时区折算）。
 * 于是"注册时间"看着正常、"练习时间"差 8 小时，两页对不上，
 * 从界面几乎无法判断哪个才是真的（只能去查库）。
 *
 * ── 两种输入形态都必须兼容 ──────────────────────────────────────────────────
 *
 *   · 带时区的 ISO 串（`...Z` 或 `+08:00`）→ 折算成上海墙上时间后展示；
 *   · 不带时区的墙上时间（`YYYY-MM-DD HH:MM:SS`）→ 原样展示。
 *     这种值**不能**丢给 `new Date()`：Safari 解析不了带空格的形式（得到
 *     Invalid Date）；即便解析成功，多数引擎按 UTC 处理，又会平白多算 8 小时。
 *
 * 全站时间口径是 Asia/Shanghai（见 lib/practice-stats 的文件头），所以这里
 * 固定按上海折算，不依赖使用者机器的时区 —— 后台可能被从任何时区打开。
 */

/** 不带时区的墙上时间：YYYY-MM-DD[ T]HH:MM[:SS] */
const NAIVE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/
/** 末尾带时区标识：Z / +08:00 / +0800 */
const ZONED_RE = /(Z|[+-]\d{2}:?\d{2})$/

/** 把一个时间值格式化成 `YYYY-MM-DD HH:MM:SS`（上海）。取不到时给占位符。 */
export function formatAdminTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const s = String(value).trim()
  if (!s) return "—"

  // 已经是不带时区的墙上时间：原样（截到秒），不要再做时区转换
  if (NAIVE_RE.test(s) && !ZONED_RE.test(s)) {
    return s.replace("T", " ").slice(0, 19)
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.replace("T", " ").slice(0, 19)

  // sv-SE 的短格式恰好就是 YYYY-MM-DD HH:MM:SS，可直接按字典序排序
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace("T", " ")
}
