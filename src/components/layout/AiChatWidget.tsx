"use client"

import { useEffect, useRef, useState } from "react"
import { X, Send, Bot, Loader2, Gem } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
}

export function AiChatWidget() {
  const [open, setOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [diamonds, setDiamonds] = useState<number | null>(null)
  const [showToast, setShowToast] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(({ user }) => {
        if (user) {
          setLoggedIn(true)
          setDiamonds(user.diamonds ?? null)
        }
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, open])

  // Show toast when chat is closed
  useEffect(() => {
    setShowToast(!open)
  }, [open])

  if (!loggedIn) return null

  async function handleSend() {
    if (!input.trim() || sending) return
    const userMsg = input.trim()
    setInput("")
    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }]
    setMessages(newMessages)
    setSending(true)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: newMessages.slice(-10, -1),
        }),
      })
      const data = await res.json()
      if (res.status === 402 || data.error === "diamond_insufficient") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "💎 钻石不足，去练习打字赚钻石吧！每完成一句可获得钻石。" },
        ])
        return
      }
      if (!res.ok || data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: "抱歉，我暂时无法回答，请稍后再试。" }])
        return
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }])
      if (typeof data.diamondsLeft === "number") setDiamonds(data.diamondsLeft)
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "网络错误，请稍后重试。" }])
    } finally {
      setSending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
          {/* Toast bubble — above the button */}
          {showToast && (
            <div
              className="relative rounded-2xl px-4 py-2.5 shadow-lg"
              style={{
                background: "var(--foreground)",
                color: "var(--background)",
                animation: "toast-float 2.5s ease-in-out infinite",
              }}
            >
              <p className="text-sm whitespace-nowrap">有问题就找我吧 💬</p>
              {/* Triangle pointer — pointing down */}
              <div
                className="absolute -bottom-1.5 right-6 w-3 h-3 rotate-45"
                style={{ background: "var(--foreground)" }}
              />
            </div>
          )}
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-2xl transition-all hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", boxShadow: "0 4px 24px rgba(124,58,237,0.5)" }}
          >
            <Bot className="h-5 w-5" />
            <span className="hidden sm:inline">小码 AI</span>
          </button>
        </div>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-80 sm:w-[360px] h-[480px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
          >
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-white" />
              <span className="text-sm font-semibold text-white">小码 AI</span>
              <span className="text-[11px] text-white/70 ml-1">· 5💎/条</span>
            </div>
            <div className="flex items-center gap-3">
              {diamonds !== null && (
                <span className="flex items-center gap-1 text-[12px] text-white/80 font-medium">
                  <Gem className="h-3.5 w-3.5" />
                  {diamonds}
                </span>
              )}
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground/50 text-sm gap-2">
                <Bot className="h-8 w-8 text-violet-400/40" />
                <p>你好！我是小码，TypeNow 英语学习助手</p>
                <p className="text-xs">问我任何英语学习问题吧 😊</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    msg.role === "user"
                      ? "text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}
                  style={msg.role === "user" ? { background: "linear-gradient(135deg, #7c3aed, #a855f7)" } : undefined}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl rounded-bl-sm px-3 py-2">
                  <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border px-3 py-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 300))}
              onKeyDown={handleKey}
              placeholder="输入问题… (Enter 发送)"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none py-1.5 max-h-24 overflow-y-auto"
              style={{ lineHeight: "1.5" }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
