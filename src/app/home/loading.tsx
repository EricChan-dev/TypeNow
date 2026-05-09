export default function HomeLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl" />
          <div className="h-10 w-10 rounded-full border-2 border-accent border-t-transparent animate-spin relative" />
        </div>
        <p className="text-sm text-white/40">加载中…</p>
      </div>
    </div>
  )
}
