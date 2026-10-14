"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * 三态猫入口（AI小咪）：
 * - 常态：趴在屏幕边缘睡觉（动画一，循环呼吸）
 * - 鼠标移入：醒来活动（动画二，只播一遍），播完自动接坐立（动画三，循环）
 * - 按下：立刻打开聊天面板（不等动画，也不依赖抬手位置）
 * - 移入后睡觉层淡出隐藏，离开时再淡回来
 *
 * 素材由 brand/mimi/tools/export-web-assets.py 生成：三支视频裁到**同一画布**，
 * 三态切换时猫不会跳位；静态 PNG 供 prefers-reduced-motion 降级与面板头像。
 * 动画一/三 webp 无限循环；动画二 webp loop=1 **只播一次**（播完定格在坐姿末帧，
 * 不会再自己趴回去），组件计时 3.7s 后把它切到动画三坐姿循环，衔接才对。
 */
type Phase = "sleep" | "awake" | "sit"
type Active = Exclude<Phase, "sleep">

const MOTION_SRC: Record<Phase, string> = {
  sleep: "/mimi/mimi-sleep.webp",
  awake: "/mimi/mimi-awake.webp",
  sit: "/mimi/mimi-sit.webp",
}

const STATIC_SRC: Record<Phase, string> = {
  sleep: "/mimi/mimi-sleep-static.png",
  awake: "/mimi/mimi-awake-static.png",
  sit: "/mimi/mimi-sit-static.png",
}

/** 动画二（醒来）素材时长：43 帧 × 83ms ≈ 3.57s（已裁掉结尾 0.5s），留余量到 3.7s。 */
const AWAKE_PLAY_MS = 3700

export function MimiCat({ onActivate }: { onActivate: () => void }) {
  const [phase, setPhase] = useState<Phase>("sleep")
  // overlay 记录"最近一次的活跃态"：淡出回睡觉时继续播同一段，避免 sit→awake 跳变
  const [overlay, setOverlay] = useState<Active>("awake")
  // runId：每次进入活跃态自增，作为 key 触发 <img> 重挂载 → webp 从第 0 帧重播
  const [runId, setRunId] = useState(0)
  const [reduced, setReduced] = useState(false)
  const awakeTimer = useRef<number | null>(null)

  // prefers-reduced-motion：退化为静态图（状态切换仍在，只是不播动画）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  // 空闲 2.5s 后预取互动/坐立两段，首次移入不闪断
  useEffect(() => {
    const t = window.setTimeout(() => {
      new Image().src = MOTION_SRC.awake
      new Image().src = MOTION_SRC.sit
    }, 2500)
    return () => window.clearTimeout(t)
  }, [])

  // 动画二按 ?r=N 逐次换 URL，这里提前预热下一次交互要用的那份，移入立即开播
  useEffect(() => {
    new Image().src = `${MOTION_SRC.awake}?r=${runId + 1}`
  }, [runId])

  // 卸载时清掉未触发的定时器
  useEffect(
    () => () => {
      if (awakeTimer.current) window.clearTimeout(awakeTimer.current)
    },
    []
  )

  function clearAwakeTimer() {
    if (awakeTimer.current) {
      window.clearTimeout(awakeTimer.current)
      awakeTimer.current = null
    }
  }

  /** 进入某个活跃态：动画二播一遍后自动接动画三（坐立循环）。 */
  function enter(next: Active) {
    clearAwakeTimer()
    setOverlay(next)
    setPhase(next)
    setRunId((n) => n + 1)
    if (next === "awake") {
      awakeTimer.current = window.setTimeout(() => enter("sit"), AWAKE_PLAY_MS)
    }
  }

  /** 回到睡觉循环；移入中途离开也停掉「播完接坐立」的计时。 */
  function rest() {
    clearAwakeTimer()
    setPhase("sleep")
  }

  return (
    <button
      type="button"
      aria-label="有问题就找AI小咪"
      title="有问题就找AI小咪"
      onMouseEnter={() => enter("awake")}
      onMouseLeave={rest}
      onFocus={() => enter("awake")}
      onBlur={rest}
      onPointerDown={() => {
        clearAwakeTimer()
        onActivate() // 按下即开面板：不依赖抬手位置，快速点击或轻微滑动都不会丢
      }}
      onClick={() => {
        clearAwakeTimer()
        onActivate() // 键盘 Enter/Space 走这里；与按下重复触发无副作用
      }}
      className="relative block w-[117px] cursor-pointer border-0 bg-transparent p-0 outline-none sm:w-[139px] sm:-mr-[30px]"
    >
      {/* 睡觉层打底；移入后淡出隐藏（避免和活跃层叠影），离开时再淡回来 */}
      <img
        src={reduced ? STATIC_SRC.sleep : MOTION_SRC.sleep}
        alt=""
        draggable={false}
        className={cn(
          "block w-full select-none transition-opacity duration-300",
          phase === "sleep" ? "opacity-100" : "opacity-0"
        )}
      />
      <img
        key={`${overlay}-${runId}`}
        src={
          reduced
            ? STATIC_SRC[overlay]
            : // 动画二每次交互都换 URL：浏览器对已播完的 loop=1 资源，
              // 重挂载同一 URL 不会重启动画（停在中定格帧），换 URL 才能强制重播
              overlay === "awake"
                ? `${MOTION_SRC.awake}?r=${runId}`
                : MOTION_SRC[overlay]
        }
        alt=""
        draggable={false}
        className={cn(
          "absolute inset-0 h-full w-full select-none transition-opacity duration-300",
          phase === "sleep" ? "opacity-0" : "opacity-100"
        )}
      />
    </button>
  )
}
