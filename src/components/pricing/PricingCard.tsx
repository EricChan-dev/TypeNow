import Link from "next/link"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface PricingCardProps {
  name: string
  description: string
  price: string
  period: string
  originalPrice?: string
  subPeriod?: string
  features: string[]
  ctaText: string
  ctaHref: string
  variant: "neutral" | "emphasized" | "prominent"
  badge?: string
  saveBadge?: string
  onCheckout?: () => void
}

export function PricingCard({
  name,
  description,
  price,
  period,
  originalPrice,
  subPeriod,
  features,
  ctaText,
  ctaHref,
  variant,
  badge,
  saveBadge,
  onCheckout,
}: PricingCardProps) {
  const isProminent = variant === "prominent"
  const isNeutral = variant === "neutral"

  return (
    <div
      className={cn(
        "rounded-2xl p-8 flex flex-col gap-5 relative",
        isProminent
          ? "bg-card border-2 border-accent"
          : "bg-card border border-border"
      )}
    >
      {/* Badge */}
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-accent px-4 py-1 text-xs font-semibold text-white">
            {badge}
          </span>
        </div>
      )}

      {/* Name & Badge row */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-card-foreground">{name}</h3>
        {!badge && saveBadge && (
          <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
            {saveBadge}
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{description}</p>

      {/* Price */}
      <div className="flex items-end gap-2">
        {originalPrice && (
          <span className="text-sm text-muted-foreground line-through pb-1">
            {originalPrice}
          </span>
        )}
        <span className="text-[44px] font-extrabold text-card-foreground leading-none">
          {price}
        </span>
        <span className="text-sm text-muted-foreground pb-1">{period}</span>
      </div>

      {/* Save badge + sub period */}
      {saveBadge && badge && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
            {saveBadge}
          </span>
          {subPeriod && (
            <span className="text-sm text-success">{subPeriod}</span>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Features */}
      <ul className="flex flex-col gap-2.5">
        {features.map((item) => (
          <li
            key={item}
            className={cn(
              "flex items-center gap-2 text-sm text-card-foreground",
              isProminent && "font-semibold"
            )}
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                isNeutral ? "text-success" : "text-success"
              )}
            />
            {item}
          </li>
        ))}
      </ul>

      {/* CTA Button */}
      {onCheckout ? (
        <button
          onClick={onCheckout}
          className={cn(
            "inline-flex items-center justify-center rounded-lg py-3 text-[15px] font-semibold transition-all w-full",
            variant === "emphasized" &&
              "bg-primary text-primary-foreground hover:bg-primary/90",
            isProminent &&
              "bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 text-white hover:opacity-90"
          )}
        >
          {ctaText}
        </button>
      ) : (
        <Link
          href={ctaHref}
          className={cn(
            "inline-flex items-center justify-center rounded-lg py-3 text-[15px] font-semibold transition-all",
            isNeutral &&
              "border border-border text-card-foreground hover:bg-muted",
            variant === "emphasized" &&
              "bg-primary text-primary-foreground hover:bg-primary/90",
            isProminent &&
              "bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 text-white hover:opacity-90"
          )}
        >
          {ctaText}
        </Link>
      )}
    </div>
  )
}
