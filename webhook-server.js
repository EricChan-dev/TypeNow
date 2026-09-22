const http = require("http")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")

// 允许用同目录下的 .env.webhook 提供密钥。
// 只靠 `export WEBHOOK_SECRET=... && pm2 restart --update-env` 是不可靠的：
// pm2 resurrect / 机器重启后启动 shell 的环境就没了，密钥会静默丢失，
// 而下面的 fail-closed 会让部署直接停摆。放在文件里才是一次配置、长期生效。
const ENV_FILE = path.join(__dirname, ".env.webhook")
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const PORT = process.env.WEBHOOK_PORT || 9000
const SECRET = process.env.WEBHOOK_SECRET || ""
const DEPLOY_CMD = "bash /home/admin/TypeNow/deploy.sh"
/** GitHub push payload 通常几十 KB，这里给足余量同时挡住无上限的 body。 */
const MAX_BODY_BYTES = 1_000_000

if (!SECRET) {
  console.error("[webhook] 未配置 WEBHOOK_SECRET —— 已拒绝所有请求（fail-closed）。")
  console.error(`[webhook] 请把密钥写入 ${ENV_FILE} 后重启本进程。`)
}

function verifySignature(req, body) {
  // 未配置密钥时拒绝一切请求。此前这里是 `return true`，等于把部署入口完全敞开；
  // 而部署入口一旦敞开，任何人都能反复触发构建把机器打满。
  if (!SECRET) return false

  const sig = req.headers["x-hub-signature-256"]
  if (typeof sig !== "string" || !sig) return false

  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex")
  const provided = Buffer.from(sig)
  const want = Buffer.from(expected)

  // timingSafeEqual 在两个 buffer 长度不同时会抛 RangeError。这一行位于 req 的
  // end 回调里，抛出去就是未捕获异常，会直接打挂进程 —— 也就是说任何人发一个
  // 长度不对的签名头都能让 webhook 崩溃重启。必须先比长度再比内容。
  if (provided.length !== want.length) return false

  return crypto.timingSafeEqual(provided, want)
}

/**
 * 取出 payload 里的 ref。
 * GitHub 的 webhook 可能被配成 application/json，也可能是
 * application/x-www-form-urlencoded（此时 body 是 payload=<urlencoded>）。
 * 两种都兼容，避免因为一个下拉框选错就静默停止部署。
 */
function extractRef(body) {
  const tryParse = (s) => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  let payload = tryParse(body)
  if (!payload) {
    const m = body.match(/^payload=([\s\S]*)$/)
    if (m) payload = tryParse(decodeURIComponent(m[1].replace(/\+/g, " ")))
  }
  return typeof payload?.ref === "string" ? payload.ref : null
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404)
    return res.end("not found")
  }

  let body = ""
  let tooLarge = false
  req.on("data", (chunk) => {
    if (tooLarge) return
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      tooLarge = true
      res.writeHead(413)
      res.end("payload too large")
      req.destroy()
    }
  })

  req.on("end", () => {
    if (tooLarge) return
    // 任何未预料的异常都不能让进程退出：pm2 会重启，但重启期间部署入口不可用，
    // 而且异常本身足以被用来制造重启风暴。
    try {
      if (!verifySignature(req, body)) {
        console.warn("[webhook] 拒绝：签名缺失或无效")
        res.writeHead(403)
        return res.end("invalid signature")
      }

      // 只有 main 分支的 push 才需要部署。此前任何签名正确的请求都会触发一次
      // 完整构建 —— 包括 GitHub 在创建钩子时发的 ping、以及任意分支的 push。
      const event = req.headers["x-github-event"]
      const ref = extractRef(body)

      if (event === "ping") {
        res.writeHead(202)
        return res.end("pong")
      }
      if (event && event !== "push") {
        res.writeHead(202)
        return res.end(`ignored event: ${event}`)
      }
      // ref 解析不出来时不拦：验签已经通过，说明请求确实来自 GitHub，
      // 这里只是省掉无谓的构建，不该因为 payload 形状变化就停掉部署。
      if (ref !== null && ref !== "refs/heads/main") {
        res.writeHead(202)
        return res.end(`ignored ref: ${ref}`)
      }

      console.log("[webhook] 收到 main 分支 push，开始部署...")
      res.writeHead(200)
      res.end("deploy started")

      exec(DEPLOY_CMD, (err, stdout, stderr) => {
        if (err) {
          console.error("[webhook] 部署失败:", err.message)
          return
        }
        console.log("[webhook] 部署输出:\n", stdout)
        if (stderr) console.error("[webhook] stderr:\n", stderr)
      })
    } catch (e) {
      console.error("[webhook] 处理请求异常:", e)
      if (!res.headersSent) {
        res.writeHead(400)
        res.end("bad request")
      }
    }
  })
})

server.listen(PORT, () => {
  console.log(`[webhook] 监听端口 ${PORT}`)
})
