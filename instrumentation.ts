// This file runs once when the Next.js server starts (Node.js runtime only).
// It sets up an in-process cron that generates recurring invoices daily at 06:00.
// No external scheduler (Vercel, cron-job.org, etc.) is required.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { Cron } = await import("croner");
  const { runRecurringInvoices } = await import("@/lib/run-recurring");

  // Run at 06:00 every day  (standard cron: min hour dom month dow)
  const schedule = process.env.RECURRING_CRON_SCHEDULE ?? "0 6 * * *";

  new Cron(schedule, { timezone: "UTC", protect: true }, async () => {
    console.log("[recurring] Starting scheduled invoice generation…");
    try {
      const { processed, results } = await runRecurringInvoices();
      const errors = results.filter((r) => r.error);
      console.log(
        `[recurring] Done — ${processed} processed, ${errors.length} errors.`,
      );
      if (errors.length > 0) {
        for (const e of errors) {
          console.error(`[recurring] Template ${e.id}: ${e.error}`);
        }
      }
    } catch (err) {
      console.error("[recurring] Fatal error:", err);
    }
  });

  console.log(`[recurring] Scheduler registered (${schedule} UTC)`);
}
