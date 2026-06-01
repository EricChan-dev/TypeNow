"use client"

import { useRef, useState } from "react"
import { Volume2, Mic, MicOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface EvalResult {
  score: number
  accuracy: number
  fluency: number
  words: { word: string; score: number }[]
}

interface VoicePanelProps {
  english: string
}

function scoreColor(s: number) {
  if (s >= 80) return "#22c55e"
  if (s >= 60) return "#f59e0b"
  return "#ef4444"
}

export function VoicePanel({ english }: VoicePanelProps) {
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [result, setResult] = useState<EvalResult | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function handleTTS() {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    setPlaying(true)
    try {
      const res = await fetch("/api/youdao/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: english }),
      })
      if (!res.ok) { toast.error("朗读失败"); setPlaying(false); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPlaying(false); URL.revokeObjectURL(url) }
      await audio.play()
    } catch {
      toast.error("朗读失败")
      setPlaying(false)
    }
  }

  async function handleRecord() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }

    setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        setEvaluating(true)
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" })
          const base64 = await blobToBase64(blob)
          const res = await fetch("/api/youdao/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64, text: english }),
          })
          const data = await res.json()
          if (!res.ok) { toast.error(data.error ?? "评分失败"); return }
          setResult(data)
        } catch {
          toast.error("评分失败，请重试")
        } finally {
          setEvaluating(false)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)

      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop()
        }
      }, 10000)
    } catch {
      toast.error("无法访问麦克风，请检查权限")
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex items-center gap-3">
        <button
          onClick={handleTTS}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
            playing
              ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
              : "bg-muted text-foreground/70 border-border hover:border-blue-500/40 hover:text-blue-400"
          )}
        >
          <Volume2 className="h-4 w-4" />
          {playing ? "停止" : "朗读"}
        </button>

        <button
          onClick={handleRecord}
          disabled={evaluating}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
            recording
              ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse"
              : "bg-muted text-foreground/70 border-border hover:border-violet-500/40 hover:text-violet-400"
          )}
        >
          {evaluating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : recording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {evaluating ? "评分中…" : recording ? "停止录音" : "跟读评分"}
        </button>
      </div>

      {result && (
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          <div
            className="flex items-center justify-center w-20 h-20 rounded-full border-4 text-3xl font-black"
            style={{ borderColor: scoreColor(result.score), color: scoreColor(result.score) }}
          >
            {result.score}
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>准确度 <span className="font-semibold" style={{ color: scoreColor(result.accuracy) }}>{result.accuracy}</span></span>
            <span>流利度 <span className="font-semibold" style={{ color: scoreColor(result.fluency) }}>{result.fluency}</span></span>
          </div>
          {result.words.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {result.words.map((w, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md text-xs font-medium border"
                  style={{
                    borderColor: scoreColor(w.score) + "60",
                    background: scoreColor(w.score) + "18",
                    color: scoreColor(w.score),
                  }}
                >
                  {w.word}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
