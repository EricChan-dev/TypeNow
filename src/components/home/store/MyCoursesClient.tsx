"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import type { Course } from "@/types/course"
import { useAcquiredCourses } from "@/lib/hooks/useAcquiredCourses"
import { CourseCard } from "./CourseCard"

export function MyCoursesClient() {
  const { acquiredIds } = useAcquiredCourses()
  const [allCourses, setAllCourses] = useState<Course[]>([])

  useEffect(() => {
    fetch("/api/courses/list?pageSize=500")
      .then((r) => r.json())
      .then((json) => { if (json.data) setAllCourses(json.data as Course[]) })
      .catch(() => {})
  }, [])

  const myCourses = allCourses.filter((c) => acquiredIds.has(c.id))

  return (
    <div className="px-6 lg:px-10 xl:px-14 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">我的课程</h1>
          <p className="text-xs text-muted-foreground mt-1">
            共 {myCourses.length} 门课程
          </p>
        </div>
      </div>

      {myCourses.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {myCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">还没有获取任何课程</p>
          <Link
            href="/home/store"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
          >
            去课程商城浏览
          </Link>
        </div>
      )}
    </div>
  )
}
