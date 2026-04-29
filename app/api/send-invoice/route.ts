import type { InvoiceRecord } from "@/types/invoice";
import { NextResponse } from "next/server";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmailHtml(invoice: InvoiceRecord): string {
  const documentTitle =
    invoice.document_type === "quote"
      ? "quote"
      : invoice.document_type === "proforma"
        ? "proforma invoice"
        : "invoice";

  const recipientName = invoice.bill_to
    ? escapeHtml(invoice.bill_to.split("\n")[0].trim())
    : "there";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(invoice.invoice_number)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#334155;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0f172a;padding:28px 40px;">
      <div style="font-size:20px;font-weight:400;color:#ffffff;letter-spacing:0.03em;">DisNetDev Software</div>
    </div>
    <div style="padding:36px 40px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${recipientName},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        Thank you for your business. Please find your ${documentTitle} (<strong>#${escapeHtml(invoice.invoice_number)}</strong>) attached to this email.
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        If you have any questions regarding this ${documentTitle}, please don't hesitate to get in touch.
      </p>
      <p style="margin:32px 0 0;font-size:15px;line-height:1.6;">
        Kind regards,<br>
        <strong>DisNetDev Software</strong>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function POST(request: Request) {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const sender = process.env.SMTP2GO_SENDER;

  if (!apiKey || !sender) {
    return NextResponse.json(
      { error: "Email service is not configured." },
      { status: 500 },
    );
  }

  let body: {
    invoice: InvoiceRecord;
    recipientEmail: string;
    pdfBase64?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { invoice, recipientEmail, pdfBase64 } = body;

  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return NextResponse.json(
      { error: "A valid recipient email address is required." },
      { status: 400 },
    );
  }

  if (!invoice || !invoice.invoice_number) {
    return NextResponse.json(
      { error: "Invalid invoice data." },
      { status: 400 },
    );
  }

  const documentTitle =
    invoice.document_type === "quote"
      ? "Quote"
      : invoice.document_type === "proforma"
        ? "Proforma Invoice"
        : "Invoice";

  const filePrefix =
    invoice.document_type === "quote"
      ? "quote"
      : invoice.document_type === "proforma"
        ? "proforma-invoice"
        : "invoice";
  const safeFileName = invoice.invoice_number
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-");
  const attachmentFilename = `${filePrefix}-${safeFileName || filePrefix}.pdf`;

  const htmlBody = buildEmailHtml(invoice);

  const smtp2goPayload: Record<string, unknown> = {
    api_key: apiKey,
    to: [recipientEmail],
    sender,
    subject: `${documentTitle} #${invoice.invoice_number}`,
    html_body: htmlBody,
  };

  if (pdfBase64) {
    smtp2goPayload.attachments = [
      {
        filename: attachmentFilename,
        fileblob: pdfBase64,
        mimetype: "application/pdf",
      },
    ];
  }

  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(smtp2goPayload),
  });

  const result = (await response.json()) as {
    data?: { succeeded: number; failed: number };
    error?: { code: number; message: string };
  };

  if (!response.ok || result.data?.succeeded !== 1) {
    const errorMsg =
      result.error?.message ?? "Failed to send email via SMTP2GO.";
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
