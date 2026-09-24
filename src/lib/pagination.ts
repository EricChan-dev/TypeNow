/**
 * 后台列表（refine.dev）分页参数收敛。
 *
 * refine 会把 URL 上的 current / pageSize 原样透传给数据接口，而此前的写法
 * `Number(searchParams.get("current") ?? "1")` 对非法输入完全没有防御。
 * 实测（Drizzle + mysql2 预编译语句 + MySQL 8）三种后果：
 *   - `pageSize=abc` → NaN → 服务端收到 NULL，而 `LIMIT NULL` 在 MySQL 里等于
 *     不加限制，接口会把整张表返回出去（句子表有 46 万行）；
 *   - `current=0` / 负数 → offset 为负 → `LIMIT 20 OFFSET -20` 直接语法错误 → 500；
 *   - `pageSize=2.5` → 小数 LIMIT → 同样语法错误 → 500。
 * 所以这里同时做三件事：非数字回落、下限钳到 1、上限钳住（并向下取整）。
 */

/** 单页最大条数：后台表格不需要更大，也是防止全表拉取的硬闸。 */
export const MAX_PAGE_SIZE = 100

/** 页码上限：只用来兜住 offset 溢出，正常翻页远达不到。 */
export const MAX_PAGE = 100_000

/** 非数字 / 小数 / 0 / 负数 / Infinity 一律回落到 fallback，并夹在 [1, max]。 */
export function toPositiveInt(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number(raw ?? "")
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

export interface Pagination {
  page: number
  pageSize: number
  offset: number
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize = 20,
): Pagination {
  // 站内有两种页码参数名：后台列表用 refine 的 current，前台接口用 page。
  // 同时识别两者，current 优先；调用方不必各自记住自己该用哪个。
  const page = toPositiveInt(
    searchParams.get("current") ?? searchParams.get("page"),
    1,
    MAX_PAGE,
  )
  const pageSize = toPositiveInt(
    searchParams.get("pageSize") ?? searchParams.get("size"),
    defaultPageSize,
    MAX_PAGE_SIZE,
  )
  return { page, pageSize, offset: (page - 1) * pageSize }
}
