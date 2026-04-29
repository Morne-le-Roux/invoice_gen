import { runRecurringInvoices } from "@/lib/run-recurring";
import { NextResponse } from "next/server";

// Protected endpoint to manually trigger recurring invoice generation.
// Can be called from Coolify's scheduled task, cron-job.org, or any cron
// with: Authorization: Bearer <CRON_SECRET>

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runRecurringInvoices();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
