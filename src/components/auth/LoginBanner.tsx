"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Mic, Puzzle, Keyboard, BookOpen } from "lucide-react"

/**
 * 登录页左栏轮播。
 *
 * 结构与文案 1:1 复刻参考页（用户 m01483 明确「尽量保持一致」；本次问答确认
 * 轮播沿用参考页原文，只换品牌）。参考页这四屏是纯静态 HTML + 一段 jQuery
 * 定时器，这里换成 React state，行为完全一致：3s 自动切换 + 圆点可点。
 *
 * 图标差异：参考页用的是自己的 iconfont（`icon-yuyin1` / `icon-pintueditor-puzzle`
 * / `icon-jianpan` / `icon-shuji`），我们没有那套字体，改用 lucide 的同类图标。
 * 尺寸仍是参考页的 32px 圆形底，所以版式不变、只有字形不同。
 */

interface Slide {
  /** 标题第一行（参考页 strong 的正文） */
  title: string
  /** 标题第二行（参考页 strong 里的 b，带本屏专属颜色） */
  highlight: string
  desc: string
  icon: typeof Mic
  /** 卡片左上角的玩法名（图标右侧那行字） */
  label: string
  /** 卡片右上角的评级角标 */
  badge: string
  /** 进度条左侧说明 */
  metric: string
  /** 进度条右侧数值 */
  percent: string
}

const SLIDES: Slide[] = [
  {
    title: "让每一次开口",
    highlight: "都更自信",
    desc: "AI 智能私教实时纠音，沉浸式语境学习，为您量身定制的英语提升方案。",
    icon: Mic,
    label: "口语测评",
    badge: "Excellent",
    metric: "流利度",
    percent: "92%",
  },
  {
    title: "像玩游戏一样",
    highlight: "组装句子",
    desc: "通过趣味句子拼图，直观掌握语法结构，让枯燥的造句练习变得生动有趣。",
    icon: Puzzle,
    label: "语法构建",
    badge: "Perfect",
    metric: "完成度",
    percent: "90%",
  },
  {
    title: "指尖律动",
    highlight: "入耳更入心",
    desc: "全键盘听写模式，在敲击中捕捉每一个语音细节。手脑协同，让听力与句型记忆同步飞跃。",
    icon: Keyboard,
    label: "键盘听写",
    badge: "Great",
    metric: "正确率",
    percent: "96%",
  },
  {
    title: "海量优质课程",
    highlight: "应有尽有",
    desc: "涵盖实用口语、中小学课本、各类应试考试及职场提升。满足全年龄段、全场景的学习需求。",
    icon: BookOpen,
    label: "课程体系",
    badge: "Rich",
    metric: "覆盖率",
    percent: "92%",
  },
]

const AUTOPLAY_MS = 3000

export function LoginBanner() {
  const [current, setCurrent] = useState(0)

  // 参考页固定 3s 自动轮播；圆点被点后重新计时（stopAutoPlay → switchTo → startAutoPlay）。
  // 开了「减少动态效果」就不自动播 —— 这是参考页没有、但属于无障碍底线的一条。
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduced) return
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % SLIDES.length)
    }, AUTOPLAY_MS)
    return () => clearInterval(timer)
  }, [current])

  return (
    <div className="loginBanner">
      <div className="banner">
        <ul>
          {SLIDES.map((slide, i) => {
            const Icon = slide.icon
            return (
              <li key={slide.title} className={i === current ? "on" : undefined}>
                <strong>
                  {slide.title}
                  <b>{slide.highlight}</b>
                </strong>
                <small>{slide.desc}</small>
                <div className="inner">
                  <div className="rotate">
                    <h5>
                      <label>
                        <i>
                          <Icon aria-hidden />
                        </i>
                        {slide.label}
                      </label>
                    </h5>
                    <span>{slide.badge}</span>
                    <div className="progress">
                      <p>
                        <em style={{ width: slide.percent }} />
                      </p>
                      <label>
                        {slide.metric}
                        <b>{slide.percent}</b>
                      </label>
                    </div>
                  </div>
                  <div className="translate">
                    <label>
                      <i className="op1" />
                      <i className="op2" />
                      <i className="op3" />
                    </label>
                    <b>10k+ 学员</b>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="backIndex">
        <Link href="/">
          <i>
            <ArrowLeft aria-hidden />
          </i>
          返回首页
        </Link>
        <p>
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              aria-label={`切换到第 ${i + 1} 屏`}
              aria-current={i === current}
              className={i === current ? "on" : undefined}
              onClick={() => setCurrent(i)}
            />
          ))}
        </p>
      </div>
    </div>
  )
}
