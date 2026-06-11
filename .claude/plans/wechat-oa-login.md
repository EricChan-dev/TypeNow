# 微信登录方式改造：扫码确认 → 关注公众号登录

## 现状分析

当前登录页（`/login`）有两个 tab：
- **微信扫码**：WeChat Open Platform 的 `qrconnect` 接口 (`snsapi_login` scope)，用户在桌面浏览器看到二维码 → 微信扫码 → 确认授权 → 登录
- **手机号登录**：短信验证码

已有 OA 流程但仅限微信内置浏览器（`flow=oa` → `snsapi_userinfo` scope），检测到移动端+微信浏览器时自动跳转 OAuth 授权。

## 改造目标

将 "微信扫码" tab 改为：显示公众号二维码 → 用户扫码关注 → 自动登录。

## 技术方案：公众号带参数二维码 + 轮询

### 核心流程

```
桌面浏览器                      服务端                       微信服务器
    │                             │                             │
    │─ GET /api/auth/wechat/oa-qrcode ──→                        │
    │                             │─ POST qrcode/create ────────→│
    │                             │←─ 返回 ticket + url ──────────│
    │←── { qrUrl, scene, expire }──│                             │
    │                             │                             │
    │  显示公众号二维码             │                             │
    │  开始轮询 check-login        │                             │
    │                             │                             │
    │                             │    用户扫码关注 ──────────────→│
    │                             │←── POST event: subscribe ─────│
    │                             │  (scene_str + openid)        │
    │                             │  存储 scene → openid         │
    │                             │  获取用户信息                 │
    │─ GET check?scene=xxx ───────→│                             │
    │←── { success, redirect } ───│                             │
    │  跳转 /home                  │                             │
```

### 需要改动的文件

#### 新增文件（3 个）

1. **`src/app/api/auth/wechat/oa-qrcode/route.ts`** — 生成临时带参数二维码
   - 调用微信 `POST /cgi-bin/qrcode/create` 创建临时二维码（30秒过期）
   - `scene_str` = 随机 32 位 hex（CSRF token）
   - 设置 `wechat_oa_scene` cookie（httpOnly, 600s）
   - 返回 `{ qrUrl, scene, expiresIn }`

2. **`src/app/api/auth/wechat/oa-check/route.ts`** — 轮询检查扫码结果
   - 读取 `wechat_oa_scene` cookie 获取 scene
   - 查内存 Map 或 Redis 是否有 scene → user 的映射
   - 如果有：创建 session，清除 cookie，返回 `{ success: true }`
   - 如果没有：返回 `{ success: false }`
   - 二维码过期：返回 `{ expired: true }`

3. **`src/app/api/wechat/oa/event/route.ts`** — 接收微信服务器推送的事件
   - 处理 `subscribe` 事件（含 `EventKey` = `qrscene_<scene_str>`）
   - 调用 `getUserInfo` 获取微信用户信息
   - 在数据库中 upsert 用户
   - 存入内存 Map：`scene → { userId, openid }`
   - 回复微信服务器的 echostr 验证（GET）和事件确认（POST）

#### 修改文件（5 个）

4. **`src/lib/wechat.ts`** — 新增函数
   - `createOAQrCode(sceneStr, expireSeconds)` — 创建临时二维码
   - `getOAQrCodeImage(ticket)` — 通过 ticket 获取二维码图片 URL
   - `storeSceneLogin(scene, userId)` / `getSceneLogin(scene)` — 内存/Redis 存储 + 过期清理
   - 注意：`getUserInfo` 使用 OA 的 OAuth2.0 流程，但 subscribe 事件回调中只有 openid，需要用 `sns/userinfo` 接口（OAuth 版）或 `/cgi-bin/user/info` 接口获取用户信息

5. **`src/components/auth/WeChatQRCode.tsx`** — 大改
   - 改为调用 `/api/auth/wechat/oa-qrcode` 获取 OA 二维码
   - 展示二维码图片（不是 iframe，而是 `<img>` 标签）
   - 开始 2 秒轮询 `/api/auth/wechat/oa-check`
   - 检测到成功后 `window.location.href = "/home"`
   - 二维码过期后自动刷新
   - 保留微信内置浏览器的 OA OAuth 自动跳转逻辑

6. **`src/components/auth/LoginForm.tsx`** — 小改
   - 静态文案更新（"微信扫码" → "微信登录"，"请使用微信扫描二维码登录" → "请使用微信扫码关注公众号登录"）
   - 可能需要新增 `follow_oa` 错误处理

7. **`src/app/api/auth/wechat/url/route.ts`** — 可选：保留 Open Platform 的 url 生成，或切换为 OA qrcode
8. **`src/app/login/page.tsx`** — 如需要，更新页面文案

### 微信服务号配置要求

- ✅ 必须是**微信服务号**（订阅号不支持带参数二维码和 `snsapi_userinfo`）
- 在微信公众平台后台配置：
  - **服务器配置**：URL = `https://typenow.cn/api/wechat/oa/event`，Token 随机生成，EncodingAESKey 随机生成，消息加解密方式选"安全模式"
  - 对应环境变量：`WECHAT_OA_TOKEN`、`WECHAT_OA_ENCODING_AES_KEY`
- 确保 `WECHAT_OA_APP_ID` 和 `WECHAT_OA_APP_SECRET` 已配置

### 可选升级：WebSocket 替代轮询

轮询 2s 一次对服务器压力不大（每个二维码 30s 过期，最多 15 次请求），但如果想更实时：
- 可用 Server-Sent Events (SSE) 替代轮询
- 或只保留轮询方案（实现更简单）

### 风险 & 注意事项

1. **内存存储**：scene→openid 映射存在内存中，服务重启会丢失。可接受因为二维码 30 秒就过期。
2. **用户信息获取**：subscribe 事件回调中没有用户昵称/头像。需要通过 `/cgi-bin/user/info` 接口单独获取（需要 OA global access_token）。
3. **已有用户关联**：通过 openid/unionid 查找已有用户，避免创建重复账号。
4. **微信消息加解密**：微信服务器推送的事件是加密的 XML。需要实现 AES 解密 + XML 解析。可以用 `xml2js` + Node 内置 `crypto` 模块。
5. **二维码样式**：微信返回的是 ticket，需要通过 `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=TICKET` 获取图片。这个 URL 可以直接用作 `<img src>`。
