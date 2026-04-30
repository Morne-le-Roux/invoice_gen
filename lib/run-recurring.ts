import type { InvoiceRecord } from "@/types/invoice";
import type { RecurringFrequency, RecurringRecord } from "@/types/recurring";
import { COMPANY_FROM_DETAILS } from "@/lib/company-details";
import { getSmtp2goSender } from "@/lib/smtp2go";
import PocketBase from "pocketbase";

export type RecurringRunResult = {
  id: string;
  invoiceId?: string;
  error?: string;
};

function advanceDate(from: string, frequency: RecurringFrequency): string {
  const d = new Date(from);
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().split("T")[0];
}

function buildInvoiceNumber(billTo: string): string {
  const lettersOnly = billTo
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(100 + Math.random() * 900));
  return `${lettersOnly}-${mm}${dd}-${rand}`;
}

export async function runRecurringInvoices(): Promise<{
  processed: number;
  results: RecurringRunResult[];
}> {
  const pbUrl =
    process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    throw new Error("PocketBase admin credentials not configured.");
  }

  const pb = new PocketBase(pbUrl);
  await pb.admins.authWithPassword(adminEmail, adminPassword);

  const today = new Date().toISOString().split("T")[0];

  const templates = await pb.collection("recurring_invoices").getFullList({
    filter: `active = true && next_run_date <= "${today}"`,
    expand: "client",
  });

  const results: RecurringRunResult[] = [];

  for (const tmpl of templates) {
    const rec = tmpl as unknown as RecurringRecord & { id: string };

    try {
      const invoiceNumber = buildInvoiceNumber(rec.bill_to ?? "");
      const invoiceDate = today;

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      const dueDateStr = dueDate.toISOString().split("T")[0];

      const invoiceData: Omit<InvoiceRecord, "id" | "expand"> = {
        user: rec.user,
        document_type: rec.document_type,
        invoice_number: invoiceNumber,
        from_details: COMPANY_FROM_DETAILS,
        bill_to: rec.bill_to,
        ship_to: rec.ship_to,
        invoice_date: invoiceDate,
        due_date: dueDateStr,
        notes: rec.notes,
        terms: rec.terms,
        tax: rec.tax,
        discount: rec.discount,
        shipping: rec.shipping,
        amount_paid: rec.amount_paid,
        items: rec.items,
        logo_data_url: "",
        logo_width: 0,
        status: "draft",
        client: rec.client,
      };

      const created = await pb.collection("invoices").create(invoiceData);

      const nextDate = advanceDate(rec.next_run_date, rec.frequency);
      await pb
        .collection("recurring_invoices")
        .update(rec.id, { next_run_date: nextDate });

      results.push({ id: rec.id, invoiceId: created.id });
    } catch (err) {
      results.push({
        id: rec.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.invoiceId).length;

  const sender = getSmtp2goSender();

  if (successCount > 0 && process.env.SMTP2GO_API_KEY && sender) {
    const projectUrl = "https://invoice.disnetdev.co.za";
    const subject =
      successCount === 1
        ? "1 new recurring invoice is ready to send"
        : `${successCount} new recurring invoices are ready to send`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#334155;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0f172a;padding:28px 40px;">
      <div style="font-size:20px;font-weight:400;color:#ffffff;letter-spacing:0.03em;">DisNetDev Software</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        ${successCount === 1 ? "1 new recurring invoice has" : `${successCount} new recurring invoices have`} been generated and are ready to be sent.
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Log in to review and send them.</p>
      <p style="margin:0;font-size:15px;line-height:1.6;">
        <a href="${projectUrl}" style="color:#2563eb;text-decoration:none;font-weight:600;">Open Invoice Generator</a>
      </p>
    </div>
  </div>
</body>
</html>`;

    const text = `${successCount === 1 ? "1 new recurring invoice has" : `${successCount} new recurring invoices have`} been generated and are ready to be sent.\n\nLog in to review and send them:\n${projectUrl}`;

    await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.SMTP2GO_API_KEY,
        to: ["morne@disnetdev.co.za"],
        sender,
        subject,
        html_body: html,
        text_body: text,
      }),
    });
  }

  return { processed: results.length, results };
}
