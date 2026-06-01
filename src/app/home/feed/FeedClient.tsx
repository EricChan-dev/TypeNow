"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { Heart, Send, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface FeedPost {
  id: string
  content: string
  likeCount: number
  createdAt: string
  userId: string
  userName: string | null
  userAvatar: string | null
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

export function FeedClient() {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [posting, setPosting] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchPosts = useCallback(async (cursor?: string) => {
    const url = cursor ? `/api/feed?cursor=${encodeURIComponent(cursor)}` : "/api/feed"
    const res = await fetch(url)
    const data = await res.json()
    return data as { data: FeedPost[]; nextCursor: string | null }
  }, [])

  useEffect(() => {
    fetchPosts()
      .then(({ data, nextCursor }) => {
        setPosts(data)
        setNextCursor(nextCursor)
      })
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false))
  }, [fetchPosts])

  useEffect(() => {
    if (!bottomRef.current || !nextCursor) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingMore) {
        setLoadingMore(true)
        fetchPosts(nextCursor)
          .then(({ data, nextCursor: nc }) => {
            setPosts((prev) => [...prev, ...data])
            setNextCursor(nc)
          })
          .catch(() => null)
          .finally(() => setLoadingMore(false))
      }
    }, { threshold: 0.5 })
    obs.observe(bottomRef.current)
    return () => obs.disconnect()
  }, [fetchPosts, nextCursor, loadingMore])

  async function handlePost() {
    if (!content.trim() || posting) return
    setPosting(true)
    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "发布失败"); return }
      toast.success("发布成功 🎉")
      setContent("")
      const { data: fresh, nextCursor: nc } = await fetchPosts()
      setPosts(fresh)
      setNextCursor(nc)
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setPosting(false)
    }
  }

  async function handleLike(postId: string) {
    const res = await fetch(`/api/feed/${postId}/like`, { method: "POST" })
    if (!res.ok) return
    const { liked } = await res.json()
    setLikedIds((prev) => {
      const next = new Set(prev)
      liked ? next.add(postId) : next.delete(postId)
      return next
    })
    setPosts((prev) => prev.map((p) => p.id === postId
      ? { ...p, likeCount: p.likeCount + (liked ? 1 : -1) }
      : p
    ))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Post box */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 500))}
          placeholder="分享你的学习心得、英语趣闻…"
          className="w-full h-24 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground/40">{content.length}/500</span>
          <button
            onClick={handlePost}
            disabled={posting || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            发布
          </button>
        </div>
      </div>

      {/* Feed list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground/50 text-sm">暂无动态，来发一条吧！</div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-accent flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0">
                  {post.userAvatar ? (
                    <Image src={post.userAvatar} alt="" width={32} height={32} className="object-cover" />
                  ) : (
                    (post.userName || "U")[0].toUpperCase()
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{post.userName || "匿名用户"}</p>
                  <p className="text-xs text-muted-foreground">{relativeTime(post.createdAt)}</p>
                </div>
              </div>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{post.content}</p>
              <div className="flex items-center gap-1 mt-3">
                <button
                  onClick={() => handleLike(post.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    likedIds.has(post.id)
                      ? "bg-red-500/10 text-red-500"
                      : "hover:bg-muted text-muted-foreground"
                  )}
                >
                  <Heart className={cn("h-3.5 w-3.5", likedIds.has(post.id) && "fill-current")} />
                  {post.likeCount}
                </button>
              </div>
            </div>
          ))}

          {/* Infinite scroll trigger */}
          <div ref={bottomRef} className="py-2 flex justify-center">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {!nextCursor && posts.length > 0 && (
              <p className="text-xs text-muted-foreground/40">已加载全部动态</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
