"use client";

import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type { InvoiceRecord } from "@/types/invoice";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildInvoiceHtml(invoice: InvoiceRecord): string {
  const safeFrom = (invoice.from_details ?? "").trim();
  const safeBillTo = (invoice.bill_to ?? "").trim();
  const safeInvoiceNumber = (invoice.invoice_number ?? "").trim();
  const safeNotes = (invoice.notes ?? "").trim();
  const safeTerms = (invoice.terms ?? "").trim();

  const documentTitle =
    invoice.document_type === "quote"
      ? "QUOTE"
      : invoice.document_type === "proforma"
        ? "PROFORMA INVOICE"
        : "INVOICE";
  const showPayments = invoice.document_type !== "quote";

  const subtotal = invoice.items.reduce(
    (sum, item) => sum + item.quantity * item.rate,
    0,
  );
  const total = Math.max(
    0,
    subtotal + invoice.tax - invoice.discount + invoice.shipping,
  );
  const balanceDue = Math.max(0, total - invoice.amount_paid);

  const exportItems = invoice.items.filter(
    (item) =>
      item.description.trim().length > 0 ||
      item.rate !== 0 ||
      item.quantity !== 1,
  );

  const itemsHtml = exportItems.length
    ? `<div class="overflow-hidden rounded border border-slate-200">
        <div class="grid grid-cols-[1fr_90px_120px_120px] bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          <div>Item</div>
          <div class="text-right">Quantity</div>
          <div class="text-right">Rate</div>
          <div class="text-right">Amount</div>
        </div>
        ${exportItems
          .map(
            (item, index) =>
              `<div class="grid grid-cols-[1fr_90px_120px_120px] items-start gap-2 border-t border-slate-200 px-4 py-3 text-sm ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}">
                <div class="min-w-0 whitespace-pre-wrap text-slate-800">${escapeHtml(item.description.trim())}</div>
                <div class="text-right text-slate-800">${item.quantity}</div>
                <div class="text-right text-slate-800">${escapeHtml(formatCurrency(item.rate))}</div>
                <div class="text-right font-semibold text-slate-700">${escapeHtml(formatCurrency(item.quantity * item.rate))}</div>
              </div>`,
          )
          .join("")}
      </div>`
    : "";

  const totalsHtml = `<div class="space-y-3 text-sm">
      <div class="flex items-center justify-between text-base">
        <span class="text-slate-500">Subtotal</span>
        <span class="font-semibold text-slate-800">${escapeHtml(formatCurrency(subtotal))}</span>
      </div>
      ${invoice.tax !== 0 ? `<div class="flex items-center justify-between"><span class="text-slate-500">Tax</span><span class="text-slate-800">${escapeHtml(formatCurrency(invoice.tax))}</span></div>` : ""}
      ${invoice.discount !== 0 ? `<div class="flex items-center justify-between"><span class="text-slate-500">Discount</span><span class="text-slate-800">${escapeHtml(formatCurrency(invoice.discount))}</span></div>` : ""}
      ${invoice.shipping !== 0 ? `<div class="flex items-center justify-between"><span class="text-slate-500">Shipping</span><span class="text-slate-800">${escapeHtml(formatCurrency(invoice.shipping))}</span></div>` : ""}
      <div class="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
        <span class="font-semibold text-slate-700">Total</span>
        <span class="font-semibold text-slate-900">${escapeHtml(formatCurrency(total))}</span>
      </div>
      ${showPayments && invoice.amount_paid !== 0 ? `<div class="flex items-center justify-between"><span class="text-slate-500">Amount Paid</span><span class="text-slate-800">${escapeHtml(formatCurrency(invoice.amount_paid))}</span></div>` : ""}
      ${showPayments ? `<div class="flex items-center justify-between border-t border-slate-200 pt-3 text-base"><span class="font-semibold text-slate-700">Balance Due</span><span class="font-semibold text-slate-900">${escapeHtml(formatCurrency(balanceDue))}</span></div>` : ""}
    </div>`;

  return `<div class="w-[794px] bg-white p-10 text-slate-700">
    <div class="mb-8 flex items-start justify-between gap-8">
      <div style="flex:1;min-width:0;">
        <img
          src="/DisNetDev Software.svg"
          alt="DisNetDev Software logo"
          class="mb-4 object-contain"
          style="width:380px;height:auto;display:block;"
        />
        ${safeFrom ? `<div class="text-sm font-semibold text-slate-500">From</div><div class="whitespace-pre-wrap text-sm text-slate-800">${escapeHtml(safeFrom)}</div>` : ""}
        ${safeBillTo ? `<div class="mt-5"><div class="text-sm font-semibold text-slate-500">Bill To</div><div class="whitespace-pre-wrap text-sm text-slate-800">${escapeHtml(safeBillTo)}</div></div>` : ""}
      </div>
      <div class="w-72 shrink-0">
        <div class="text-right text-4xl font-light tracking-wide text-slate-900">${documentTitle}</div>
        <div class="mt-5 space-y-2 text-sm">
          ${safeInvoiceNumber ? `<div class="flex items-baseline justify-between gap-6"><span class="font-semibold text-slate-500">Invoice No.</span><span class="text-right text-slate-800">#${escapeHtml(safeInvoiceNumber)}</span></div>` : ""}
          ${invoice.invoice_date ? `<div class="flex items-baseline justify-between gap-6"><span class="font-semibold text-slate-500">Date</span><span class="text-right text-slate-800">${escapeHtml(invoice.invoice_date)}</span></div>` : ""}
          ${invoice.due_date ? `<div class="flex items-baseline justify-between gap-6"><span class="font-semibold text-slate-500">Due Date</span><span class="text-right text-slate-800">${escapeHtml(invoice.due_date)}</span></div>` : ""}
        </div>
      </div>
    </div>

    ${itemsHtml}

    <div class="mt-8 grid gap-8 ${safeNotes || safeTerms ? "md:grid-cols-[1.3fr_1fr]" : ""}">
      ${
        safeNotes || safeTerms
          ? `<div>
          ${safeNotes ? `<div class="text-sm font-semibold text-slate-500">Notes</div><div class="mt-1 whitespace-pre-wrap text-sm text-slate-800">${escapeHtml(safeNotes)}</div>` : ""}
          ${safeTerms ? `<div class="mt-6 text-sm font-semibold text-slate-500">Terms</div><div class="mt-1 whitespace-pre-wrap text-sm text-slate-800">${escapeHtml(safeTerms)}</div>` : ""}
        </div>`
          : ""
      }
      ${totalsHtml}
    </div>

    <div class="mt-8 border-t border-slate-200 pt-6">
      <div class="text-sm font-semibold text-slate-500">Banking Details</div>
      <div class="mt-1 text-sm text-slate-800 leading-relaxed">
        <div>Account Holder: DisNetDev</div>
        <div>Account Type: Savings Account</div>
        <div>Discovery Bank</div>
        <div>Branch Code: 679000</div>
        <div>Account Number: 19742778391</div>
      </div>
    </div>
  </div>`;
}

async function renderInvoiceImage(invoice: InvoiceRecord): Promise<{
  imageData: string;
  nodeWidth: number;
  nodeHeight: number;
}> {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.pointerEvents = "none";
  container.innerHTML = buildInvoiceHtml(invoice);
  document.body.appendChild(container);

  try {
    const node = container.firstElementChild as HTMLElement;
    if (!node) throw new Error("Failed to build invoice element.");

    // Allow images to load before capturing.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const rect = node.getBoundingClientRect();
    const nodeWidth = Math.ceil(rect.width);
    const nodeHeight = Math.ceil(rect.height);

    if (!nodeWidth || !nodeHeight) {
      throw new Error("Unable to calculate invoice dimensions.");
    }

    const MAX_CANVAS_DIMENSION = 16_384;
    const safePixelRatio =
      Math.max(nodeWidth, nodeHeight) * 2 <= MAX_CANVAS_DIMENSION ? 2 : 1;

    const imageData = await toPng(node, {
      backgroundColor: "#ffffff",
      width: nodeWidth,
      height: nodeHeight,
      style: {
        width: `${nodeWidth}px`,
        height: `${nodeHeight}px`,
        overflow: "visible",
        margin: "0",
        transform: "none",
      },
      canvasWidth: nodeWidth * safePixelRatio,
      canvasHeight: nodeHeight * safePixelRatio,
      pixelRatio: safePixelRatio,
      cacheBust: true,
      skipFonts: true,
      filter: (node) => {
        if (
          node instanceof HTMLElement &&
          node.classList.contains("no-print")
        ) {
          return false;
        }
        return true;
      },
    });

    return { imageData, nodeWidth, nodeHeight };
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}

export async function generateInvoicePreviewDataUri(
  invoice: InvoiceRecord,
): Promise<{ dataUri: string; width: number; height: number }> {
  const { imageData, nodeWidth, nodeHeight } =
    await renderInvoiceImage(invoice);
  return {
    dataUri: imageData,
    width: nodeWidth,
    height: nodeHeight,
  };
}

/**
 * Generates a PDF of the given invoice and returns it as a base64-encoded string.
 * Must be called in a browser context.
 */
export async function generateInvoicePdfBase64(
  invoice: InvoiceRecord,
): Promise<string> {
  const { imageData, nodeWidth, nodeHeight } =
    await renderInvoiceImage(invoice);

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const PDF_MARGIN_MM = 10;
  const contentWidth = Math.max(0, pageWidth - PDF_MARGIN_MM * 2);
  const contentHeight = Math.max(0, pageHeight - PDF_MARGIN_MM * 2);

  const imageWidth = contentWidth;
  const imageHeight = (nodeHeight * imageWidth) / nodeWidth;

  let remainingHeight = imageHeight;
  let position = PDF_MARGIN_MM;

  pdf.addImage(
    imageData,
    "PNG",
    PDF_MARGIN_MM,
    PDF_MARGIN_MM,
    imageWidth,
    imageHeight,
    undefined,
    "FAST",
  );
  remainingHeight -= contentHeight;

  while (remainingHeight > 0) {
    position = PDF_MARGIN_MM + (remainingHeight - imageHeight);
    pdf.addPage();
    pdf.addImage(
      imageData,
      "PNG",
      PDF_MARGIN_MM,
      position,
      imageWidth,
      imageHeight,
      undefined,
      "FAST",
    );
    remainingHeight -= contentHeight;
  }

  // Return pure base64 (strip the "data:application/pdf;base64," prefix)
  const dataUri = pdf.output("datauristring");
  return dataUri.split(",")[1] ?? dataUri;
}
