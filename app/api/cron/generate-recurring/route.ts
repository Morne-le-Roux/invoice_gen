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

          const htmlBody = buildEmailHtml(fullInvoice);

          await fetch("https://api.smtp2go.com/v3/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: process.env.SMTP2GO_API_KEY,
              to: [recipientEmail],
              sender: process.env.SMTP2GO_SENDER,
              subject: `Invoice #${invoiceNumber}`,
              html_body: htmlBody,
            }),
          });

          await pb
            .collection("invoices")
            .update(created.id, { status: "sent" });
        }
      }

      results.push({ id: rec.id, invoiceId: created.id });
    } catch (err) {
      results.push({
        id: rec.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
