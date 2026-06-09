"use client"

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-5">
      <p className="text-lg font-bold text-foreground">页面加载出错</p>
      <p className="text-sm text-foreground/40 text-center max-w-md">
        抱歉，页面加载过程中出现了问题，请稍后重试。
      </p>
      <button
        onClick={reset}
        className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-accent/90 transition-colors"
      >
        重新加载
      </button>
    </div>
  )
}
