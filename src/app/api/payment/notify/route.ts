import { NextResponse } from "next/server"
import { verifyNotifySignature } from "@/lib/wechat-pay"
import { activateSubscription } from "@/lib/subscription"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const signature = request.headers.get("Wechatpay-Signature") || ""
    const timestamp = request.headers.get("Wechatpay-Timestamp") || ""
    const nonce = request.headers.get("Wechatpay-Nonce") || ""

    if (!verifyNotifySignature(timestamp, nonce, body, signature)) {
      return NextResponse.json(
        { code: "FAIL", message: "Invalid signature" },
        { status: 401 }
      )
    }

    const notify = JSON.parse(body)
    const { out_trade_no, transaction_id, trade_state } = notify

    if (trade_state !== "SUCCESS") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    const serviceClient = createServiceClient()
    if (!serviceClient) {
      return NextResponse.json(
        { code: "FAIL", message: "Service not configured" },
        { status: 500 }
      )
    }

    const { data: existing } = await serviceClient
      .from("payment_orders")
      .select("id, user_id, plan, status")
      .eq("out_trade_no", out_trade_no)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json(
        { code: "FAIL", message: "Order not found" },
        { status: 404 }
      )
    }

    if (existing.status === "paid") {
      return NextResponse.json({ code: "SUCCESS", message: "OK" })
    }

    const { error: updateError } = await serviceClient
      .from("payment_orders")
      .update({
        status: "paid",
        transaction_id,
        paid_at: new Date().toISOString(),
      })
      .eq("id", existing.id)

    if (updateError) {
      return NextResponse.json(
        { code: "FAIL", message: "Update failed" },
        { status: 500 }
      )
    }

    await activateSubscription(existing.user_id, existing.plan, existing.id)

    return NextResponse.json({ code: "SUCCESS", message: "OK" })
  } catch (err) {
    console.error("Notify error:", err)
    return NextResponse.json(
      { code: "FAIL", message: "Internal error" },
      { status: 500 }
    )
  }
}
