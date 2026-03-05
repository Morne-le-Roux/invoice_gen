"use client";

import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";

type InvoiceItem = {
  id: number;
  description: string;
  quantity: number;
  rate: number;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

export default function Home() {
  const invoiceRef = useRef<HTMLElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("1");
  const [from, setFrom] = useState("");
  const [billTo, setBillTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [tax, setTax] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [amountPaid, setAmountPaid] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const [items, setItems] = useState<InvoiceItem[]>([
    { id: 1, description: "", quantity: 1, rate: 0 },
  ]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.rate, 0),
    [items],
  );

  const total = Math.max(0, subtotal + tax - discount + shipping);
  const balanceDue = Math.max(0, total - amountPaid);

  const handleItemChange = (
    id: number,
    key: keyof Omit<InvoiceItem, "id">,
    value: string,
  ) => {
    setItems((previousItems) =>
      previousItems.map((item) => {
        if (item.id !== id) {
          return item;
        }

        if (key === "description") {
          return { ...item, description: value };
        }

        const parsedValue = Number(value);
        return {
          ...item,
          [key]: Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0,
        };
      }),
    );
  };

  const addLineItem = () => {
    setItems((previousItems) => [
      ...previousItems,
      { id: Date.now(), description: "", quantity: 1, rate: 0 },
    ]);
  };

  const uploadLogo = (file: File | null) => {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const exportInvoice = async () => {
    if (!invoiceRef.current || isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");

      const node = invoiceRef.current;

      const imageData = await toPng(node, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        cacheBust: true,
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

      const nodeWidth = node.scrollWidth;
      const nodeHeight = node.scrollHeight;
      if (!nodeWidth || !nodeHeight) {
        throw new Error("Unable to calculate invoice dimensions.");
      }

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageWidth = pageWidth;
      const imageHeight = (nodeHeight * imageWidth) / nodeWidth;

      let remainingHeight = imageHeight;
      let position = 0;

      pdf.addImage(
        imageData,
        "PNG",
        0,
        position,
        imageWidth,
        imageHeight,
        undefined,
        "FAST",
      );
      remainingHeight -= pageHeight;

      while (remainingHeight > 0) {
        position = remainingHeight - imageHeight;
        pdf.addPage();
        pdf.addImage(
          imageData,
          "PNG",
          0,
          position,
          imageWidth,
          imageHeight,
          undefined,
          "FAST",
        );
        remainingHeight -= pageHeight;
      }

      const safeInvoiceNumber =
        typeof invoiceNumber === "string" ? invoiceNumber.trim() : "";
      const safeFileName = safeInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, "-");
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoice-${safeFileName || "invoice"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invoice export failed.";
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-700 sm:px-8 print:bg-white print:p-0">
      <main
        ref={invoiceRef}
        className="mx-auto w-full max-w-6xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-4 print:shadow-none"
      >
        <div className="mb-6 flex items-center justify-end">
          <button
            type="button"
            onClick={exportInvoice}
            disabled={isExporting}
            className="no-print rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? "Generating PDF..." : "Export Invoice"}
          </button>
        </div>
        {exportError ? (
          <p className="mb-4 text-right text-sm text-red-600">{exportError}</p>
        ) : null}

        <section className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => uploadLogo(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="mb-4 flex h-32 w-48 items-center justify-center rounded border border-slate-300 bg-slate-50 text-slate-400"
            >
              {logoDataUrl ? (
                <Image
                  src={logoDataUrl}
                  alt="Company logo"
                  width={192}
                  height={128}
                  unoptimized
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="font-semibold">+ Add Your Logo</span>
              )}
            </button>

            <label className="mb-2 block text-sm font-semibold text-slate-500">
              Who is this from?
            </label>
            <textarea
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="Business name, address, contact"
              rows={3}
              className="mb-5 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-500">
                  Bill To
                </label>
                <textarea
                  value={billTo}
                  onChange={(event) => setBillTo(event.target.value)}
                  placeholder="Who is this to?"
                  rows={3}
                  className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-500">
                  Ship To
                </label>
                <textarea
                  value={shipTo}
                  onChange={(event) => setShipTo(event.target.value)}
                  placeholder="(optional)"
                  rows={3}
                  className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
                />
              </div>
            </div>
          </div>

          <div>
            <h1 className="mb-3 text-right text-5xl font-light tracking-wide text-slate-900">
              INVOICE
            </h1>
            <div className="mb-6 grid grid-cols-[40px_1fr] rounded border border-slate-300">
              <div className="flex items-center justify-center border-r border-slate-300 text-slate-500">
                #
              </div>
              <input
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                className="w-full px-3 py-2 text-right outline-none"
              />
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-[110px_1fr] items-center gap-3">
                <label className="text-right text-slate-500">Date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 outline-none"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-3">
                <label className="text-right text-slate-500">
                  Payment Terms
                </label>
                <input
                  value={paymentTerms}
                  onChange={(event) => setPaymentTerms(event.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 outline-none"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-3">
                <label className="text-right text-slate-500">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 outline-none"
                />
              </div>
              <div className="grid grid-cols-[110px_1fr] items-center gap-3">
                <label className="text-right text-slate-500">PO Number</label>
                <input
                  value={poNumber}
                  onChange={(event) => setPoNumber(event.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[1fr_90px_120px_120px] rounded-t bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            <div>Item</div>
            <div className="text-right">Quantity</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Amount</div>
          </div>
          {items.map((item, index) => {
            const amount = item.quantity * item.rate;
            return (
              <div
                key={item.id}
                className={`grid min-w-[760px] grid-cols-[1fr_90px_120px_120px] items-center gap-2 border-x border-b border-slate-200 px-4 py-2 ${
                  index % 2 === 0 ? "bg-white" : "bg-slate-50"
                }`}
              >
                <input
                  value={item.description}
                  onChange={(event) =>
                    handleItemChange(item.id, "description", event.target.value)
                  }
                  placeholder="Description of item/service..."
                  className="rounded border border-slate-300 px-3 py-2 outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={item.quantity}
                  onChange={(event) =>
                    handleItemChange(item.id, "quantity", event.target.value)
                  }
                  className="rounded border border-slate-300 px-3 py-2 text-right outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.rate}
                  onChange={(event) =>
                    handleItemChange(item.id, "rate", event.target.value)
                  }
                  className="rounded border border-slate-300 px-3 py-2 text-right outline-none"
                />
                <div className="text-right font-semibold text-slate-600">
                  {formatCurrency(amount)}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addLineItem}
            className="mt-3 rounded border border-emerald-500 px-4 py-2 font-semibold text-emerald-600"
          >
            + Line Item
          </button>
        </section>

        <section className="mt-8 grid gap-8 md:grid-cols-[1.3fr_1fr]">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-500">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Notes - any relevant information not already covered"
              className="mb-6 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
            />

            <label className="mb-2 block text-sm font-semibold text-slate-500">
              Terms
            </label>
            <textarea
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              rows={4}
              placeholder="Terms and conditions - late fees, payment methods, delivery schedule"
              className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
            />
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between text-base">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-semibold text-slate-700">
                {formatCurrency(subtotal)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-slate-500">Tax</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={tax}
                onChange={(event) =>
                  setTax(Math.max(0, Number(event.target.value) || 0))
                }
                className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-slate-500">Discount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={discount}
                onChange={(event) =>
                  setDiscount(Math.max(0, Number(event.target.value) || 0))
                }
                className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-slate-500">Shipping</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={shipping}
                onChange={(event) =>
                  setShipping(Math.max(0, Number(event.target.value) || 0))
                }
                className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
              <span className="font-semibold text-slate-700">Total</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(total)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="text-slate-500">Amount Paid</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amountPaid}
                onChange={(event) =>
                  setAmountPaid(Math.max(0, Number(event.target.value) || 0))
                }
                className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
              <span className="font-semibold text-slate-700">Balance Due</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(balanceDue)}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
