# 哇学社 waxueshe.com 「单词仓库」逆向分析

> 采集方式:CDP 附加真实浏览器,抓取 `/words/index` 与 `/words/:id` 的运行时流量;
> 同时下载前端 bundle(`v0.0.196/assets/index-DGwNVETT.js`,1.48MB)做静态提取。
> 采集时间:2026-10-15。仅记录公开可观测的技术事实,用于产品对照。

## 1. 前端架构

| 项 | 值 |
|---|---|
| 框架 | Vue 3(`#app[data-v-app]`,无 SSR,无 `__NUXT_DATA__`/`__NEXT_DATA__`) |
| 构建 | Vite,单 bundle,版本随资源路径发布:`/v0.0.196/assets/index-DGwNVETT.js` |
| 组件库 | Element Plus(`el-tooltip__trigger` 等) |
| 状态 | pinia v3 |
| HTTP | axios,`baseURL: "https://api.waxueshe.com" + "/api/v2"`,timeout 60s |
| 静态资源 | 独立域 `res.waxueshe.com`(封面 `lesson_cover/lesson-cover-*.png`) |

### Vue Router 路由表(全量提取)

```
/words/index  /words/:id          ← 单词仓库(列表/详情)
/learnPlay/word  /learnPlay/sentence  /learnPlay/wordDetail/:id  /learnPlay/sentenceDetail/:id
/myCourse/word  /myCourse/sentence  /myCourse/wordDetail/:id  /myCourse/sentenceDetail/:id
/courseMall/index  /courseMall/:id  /courseMall/detail/:id
/teachMall/index  /teachMall/:id    /phoneticCourse/index  /phoneticCourse/:id  /phoneticCourse/detail/:id
/noteBooks/index  /rank/index  /pkArena/{index,loading,matching,lobby}  /talk/index  /ai/index
/partnerPlan/{index,introduce}  /vip/index  /foreverVip/index  /invite/index  /setting/index
/lottery/{index,gift/:token?}  /home/index  /game  /gameLoad  /pk  /pk/{match,loading}
/tracking/detail  /voice/audit  /richtext/:type  /ref/:ref  /ref/:code  /pkinvite/:code?
/login/{index,sms,forget,register,bind,wxlogin,wxregister,loginEmail,smsEmail,forgetEmail,registerEmail}
/wechat  /web  /wechat/callback
```

## 2. 后端 API 与鉴权

- **Base**:`https://api.waxueshe.com/api/v2`(前缀可配置覆盖)
- **统一响应**:`{ code: 0, msg: "ok", data: ... }`;未登录 → HTTP 401 + `{ code: 16, msg: "未认证" }`
- **鉴权**:`Authorization: Bearer <token>`,token 存 **`localStorage.TOKEN`**(www.waxueshe.com 域,非 cookie)。
  请求拦截器自动附加;`meta.omitAuthorization` 可跳过;存在静默 token 刷新(`skipTokenRefresh` meta 标记)。
- **其他 localStorage 键**:`REF`(推广)、`ACCOUNT`、`ACCOUNTEMAIL`、`WXLOGINQRCODEID`、`WXLOGINBINDTOKEN`、`WECHATH5OAUTHCONTEXT:` 前缀、`REGISTRATION_SOURCE_V1`
- **登录方式**:手机短信(`/auth/sms/send`)+ 邮箱(`/auth/email/send`、`/auth/email/check`)+ 微信(`/auth/wechat/check`、H5 OAuth 上下文)

## 3. /words/index(单词仓库)数据流

加载顺序共 3 个请求,全部**无需登录**:

1. `GET /api/v2/config` — 站点配置
2. `GET /api/v2/lesson_categories?type=2` — 词书分类树
3. `GET /api/v2/word/lesson?page=1&limit=40&lesson_category_id=0&mode=0` — 词书分页列表

### /config 关键字段

`app_version`、`allowed_email_providers: "gmail,outlook,163"`、`register_invite_code_required: "0"`、
`lottery_activity_enabled`、`national_day_activity_enabled`、`study_host_feat_enabled: "1"`、
`oral_assessment_api: "2"`(口语评测供应商版本)、`vip_stock_visible: "0"`、
`splitSentenceColor` / `splitPhoneticColor`(**句子成分/音标配色方案由后端下发**,如 `{"name":"主语","color":"..."}`)、
各协议全文(user_agreement/privacy_policy/collection_audio_warn/membership_open_agreement/promotion_rules)、
各社群/客服二维码 URL、feedback 飞书表单链接。

### /lesson_categories?type=2 分类树

6 个顶级(学习阶段)→ 81 个子分类(教材版本):

| id | 顶级 | 子分类数 |
|----|------|---------|
| 179 | 小学 | 32(183=人教版PEP、198=人教一年级起点、200=译林、201=外研社……) |
| 180 | 初中 | 10 |
| 181 | 高中 | 9 |
| 182 | 大学 | 11 |
| 196 | 留学 | 7 |
| 214 | 其他 | 12 |

### /word/lesson 词书列表

请求:`page`、`limit=40`、`lesson_category_id=0`(全部)/具体子分类 id、`mode=0`

响应信封(Laravel 风格分页):`data.word_lessons = { data[], total, current_page, per_page, last_page }`

词书 item 结构:

```json
{
  "id": 310, "lesson_category_id": 183,
  "name": "(新课标) 三年级上册人教版PEP",
  "describe": "（最新）三年级上册人教版PEP",
  "image": "https://res.waxueshe.com/.../lesson-cover-*.png",
  "heat": "99999",            // 热度,字符串,默认按此倒序
  "wordCount": 107,
  "updated_at": 1789315003,   // unix 秒
  "is_public": true, "is_completed": false,
  "created_at": 1775392726,
  "related_lessons": [ { "id": 1336, "name": "...", "status": 1, "type": 1, "lesson_category_id": 12 } ]
}
```

> `related_lessons` 把词书关联到**主课课程库**的 lesson(category 12/13),说明「词书」与「课程」是两套 ID 体系、相互挂接:词书入口给背单词,关联课程入口给课文学习。

## 4. 词书详情 /words/:id(登录墙)

- `GET /api/v2/word/lesson_practice?id=310&mode=0` → **401 未认证**(未登录直接拦截)
- 未登录弹窗:「您还未登录或登录失效,是否前往登录?」;页面仍显示词书头部:已收藏、暂无介绍、「章节共 0 词」、「章节单词数量:**20**」(每章 20 词)、「重置学习进度」
- `mode` 参数同时出现在列表与练习接口,推测为学习模式切换(0=默认)

## 5. bundle 静态提取的 API 面(68 端点)

**GET**:`/auth/email/check`、`/config`、`/founder_vip`、`/game-pk/{activities,banners,competition/capability,invitations/snapshot,my/records,my/stats,rankings,recommended-courses,regions/tree,rooms,rooms/detail,rooms/my,rooms/progress,rooms/settlement,rooms/users,title-rules}`、`/game/exercise_page`、`/game/sentences`、`/index/notice_detail`、`/index/user_count`、`/lesson_mall`、`/order/vip`、`/promotion_rules`、`/users/my`、`/users/my/query_setting`、`/users/my/wechat/qrcode`、`/word/lesson`

**POST**:`/auth/{logout,wechat/check}`、`/game-pk/competition/{edit,kick,share}`、`/game-pk/invitations(+/respond)`、`/game-pk/rooms/{answer,cancel-signup,continue,delete,host,next-question,question-progress,ready,result,robots,robots/delete,save/answer,settlement,signup,start-time,status}`、`/game-wss/ticket`(PK 实时对战的 WebSocket 票据)、`/proxy/region/resolve`、`/user/experience_code/exchange`、`/users/my/{set_fee_tip,set_head_image,set_name,set_signature,set_wechat_id,set_wechat_qr_code,update_setting}`

**运行时观测**(登录墙外/首页):`/index/{notice,date_hot,index,count,study_num,user_count}`、`/rank/list?type=4&limit=50`、`/popup_notice?popup_page=1`、`/word/lesson_practice`

## 6. 对 TypeNow 的对照点

1. **内容三级结构**:`lesson_categories`(教材树)≈ 我们的 courses;`word/lesson`(词书,107~5524 词/本)≈ lessons;词书内**每章 20 词**的分章学习 ≈ 我们的 sentence 粒度拆分。
2. **双库互挂**:`related_lessons` 把词书挂到课文课程的 lesson 上 —— 单词库与课程库独立 ID、双向关联,我们做「课本同步」时可参考。
3. **运营位配置化**:`/config` 把活动开关、协议全文、二维码、配色方案全部后端下发,前端零硬编码;我们的 `splitSentenceColor` 思路可用于句法成分着色(TypeNow 已有 `sentence_structure`,配色下发是现成模式)。
4. **热度排序**:`heat` 字符串字段驱动默认排序(人工运营热度),而非真实学习人数。
5. **分页信封**:Laravel 风格 `{data,total,current_page,per_page,last_page}`,嵌套在业务键 `word_lessons` 下。
6. **鉴权**:纯 `Bearer + localStorage.TOKEN`(无 cookie session),静默刷新;我们的 session-cookie 方案与其相反,属有意差异。

## 7. 待补(需登录态)

词书内的实际单词内容与章节结构(`/word/lesson_practice` 的完整 data)、学习进度/收藏/PK 等登录接口的行为细节。
获取方式:已登录浏览器 F12 → Application → Local Storage → `https://www.waxueshe.com` → 复制 `TOKEN` 值。
