"use client"

import Link from "next/link"
import {
  MessageCircle,
  Plane,
  Briefcase,
  Share2,
  Clapperboard,
  GraduationCap,
} from "lucide-react"
import { SCENES } from "@/types"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  MessageCircle,
  Plane,
  Briefcase,
  Share2,
  Clapperboard,
  GraduationCap,
}

export function SceneSelector() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {SCENES.map((scene) => {
        const Icon = iconMap[scene.icon]
        return (
          <Link
            key={scene.key}
            href={`/practice?scene=${scene.key}`}
            className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:border-accent/50 hover:bg-muted/50 transition-all text-center"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${scene.color}15` }}
            >
              {Icon && (
                <div style={{ color: scene.color }}>
                  <Icon className="h-5 w-5" />
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{scene.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {scene.description}
              </p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
