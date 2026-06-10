import { getSmtp2goSender } from "@/lib/smtp2go";
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

type EmailType = "standard" | "late";

function getDocumentTitle(invoice: InvoiceRecord): string {
  return invoice.document_type === "quote"
    ? "quote"
    : invoice.document_type === "proforma"
      ? "proforma invoice"
      : "invoice";
}

function buildEmailHtml(invoice: InvoiceRecord, emailType: EmailType): string {
  const documentTitle = getDocumentTitle(invoice);

  const recipientName = invoice.bill_to
    ? escapeHtml(invoice.bill_to.split("\n")[0].trim())
    : "there";

  const introParagraph =
    emailType === "late"
      ? `This is a reminder that ${documentTitle} (<strong>#${escapeHtml(invoice.invoice_number)}</strong>) is now overdue. Please find a copy attached for reference.`
      : `Thank you for your business. Please find your ${documentTitle} (<strong>#${escapeHtml(invoice.invoice_number)}</strong>) attached to this email.`;

  const followUpParagraph =
    emailType === "late"
      ? "If payment is not received within the next 5 days, services might be cut off. If payment has already been made, please disregard this message."
      : `If you have any questions regarding this ${documentTitle}, please don't hesitate to get in touch.`;

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
        ${introParagraph}
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        ${followUpParagraph}
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
  const sender = getSmtp2goSender();

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
    emailType?: EmailType;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { invoice, recipientEmail, pdfBase64, emailType = "standard" } = body;

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

  if (emailType !== "standard" && emailType !== "late") {
    return NextResponse.json({ error: "Invalid email type." }, { status: 400 });
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

  const htmlBody = buildEmailHtml(invoice, emailType);
  const subjectPrefix = emailType === "late" ? "Late Payment Notice: " : "";

  const smtp2goPayload: Record<string, unknown> = {
    api_key: apiKey,
    to: [recipientEmail],
    sender,
    subject: `${subjectPrefix}${documentTitle} #${invoice.invoice_number}`,
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

  let result: {
    data?: { succeeded: number; failed: number };
    error?: { code: number; message: string };
  } = {};
  const responseText = await response.text();
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      // non-JSON response; fall through to status check below
    }
  }

  if (!response.ok || result.data?.succeeded !== 1) {
    const errorMsg =
      result.error?.message ??
      responseText ??
      "Failed to send email via SMTP2GO.";
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
