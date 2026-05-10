const http = require("http")
const crypto = require("crypto")
const { exec } = require("child_process")

const PORT = process.env.WEBHOOK_PORT || 9000
const SECRET = process.env.WEBHOOK_SECRET || ""  // 在 GitHub Webhook 设置里填写，留空则不验证

const DEPLOY_CMD = "bash /home/admin/TypeNow/deploy.sh"  // ← 改成实际路径

function verifySignature(req, body) {
  if (!SECRET) return true
  const sig = req.headers["x-hub-signature-256"]
  if (!sig) return false
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404)
    return res.end("not found")
  }

  let body = ""
  req.on("data", (chunk) => (body += chunk))
  req.on("end", () => {
    if (!verifySignature(req, body)) {
      res.writeHead(403)
      return res.end("invalid signature")
    }

    console.log("[webhook] 收到 GitHub push，开始部署...")
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
  })
})

server.listen(PORT, () => {
  console.log(`[webhook] 监听端口 ${PORT}`)
})
