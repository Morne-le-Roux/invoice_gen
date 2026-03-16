"use client";

import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import Image from "next/image";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type InvoiceItem = {
  id: number;
  description: string;
  quantity: number;
  rate: number;
};

type DocumentType = "invoice" | "quote" | "proforma";

const STORAGE_KEYS = {
  logoDataUrl: "invoice_gen.logoDataUrl",
  logoWidth: "invoice_gen.logoWidth",
  from: "invoice_gen.from",
} as const;

const MIN_LOGO_WIDTH = 80;
const MAX_LOGO_WIDTH = 640;
const DEFAULT_LOGO_ASPECT_RATIO = 2 / 3;

const toDocumentPrefix = (value: string) => {
  const lettersOnly = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  const prefix = lettersOnly.slice(0, 3);
  return prefix.padEnd(3, "X");
};

const generateDocumentNumber = (billTo: string) => {
  const prefix = toDocumentPrefix(billTo);
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${digits}`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

export default function Home() {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const exportInvoiceRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const hasRestoredFromStorage = useRef(false);

  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoWidth, setLogoWidth] = useState(192);
  const [logoAspectRatio, setLogoAspectRatio] = useState(
    DEFAULT_LOGO_ASPECT_RATIO,
  );
  const [invoiceNumber, setInvoiceNumber] = useState("1");
  const [from, setFrom] = useState("");
  const [billTo, setBillTo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
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

  const safeFrom = from.trim();
  const safeBillTo = billTo.trim();
  const safeShipTo = shipTo.trim();
  const safeInvoiceNumber = invoiceNumber.trim();
  const safeNotes = notes.trim();
  const safeTerms = terms.trim();

  const logoHeight = Math.round(logoWidth * logoAspectRatio);

  const documentTitle =
    documentType === "quote"
      ? "QUOTE"
      : documentType === "proforma"
        ? "PROFORMA INVOICE"
        : "INVOICE";
  const filePrefix =
    documentType === "quote"
      ? "quote"
      : documentType === "proforma"
        ? "proforma-invoice"
        : "invoice";

  const showPayments = documentType !== "quote";

  const exportItems = useMemo(
    () =>
      items.filter((item) => {
        const hasDescription = item.description.trim().length > 0;
        const hasRate = item.rate !== 0;
        const hasNonDefaultQuantity = item.quantity !== 1;
        return hasDescription || hasRate || hasNonDefaultQuantity;
      }),
    [items],
  );

  useEffect(() => {
    const current = invoiceNumber.trim();
    const shouldAutogenerate = current === "" || current === "1";
    if (!shouldAutogenerate) {
      return;
    }

    if (!safeBillTo) {
      return;
    }

    setInvoiceNumber(generateDocumentNumber(safeBillTo));
  }, [invoiceNumber, safeBillTo]);

  useEffect(() => {
    if (hasRestoredFromStorage.current) {
      return;
    }

    try {
      const storedLogo = localStorage.getItem(STORAGE_KEYS.logoDataUrl);
      const storedLogoWidth = localStorage.getItem(STORAGE_KEYS.logoWidth);
      const storedFrom = localStorage.getItem(STORAGE_KEYS.from);

      if (storedLogo) {
        setLogoDataUrl(storedLogo);
      }
      if (storedLogoWidth) {
        const parsedWidth = Number(storedLogoWidth);
        if (Number.isFinite(parsedWidth)) {
          setLogoWidth(
            Math.min(
              MAX_LOGO_WIDTH,
              Math.max(MIN_LOGO_WIDTH, Math.round(parsedWidth)),
            ),
          );
        }
      }
      if (storedFrom) {
        setFrom(storedFrom);
      }
    } catch {
      // Ignore storage errors (e.g. blocked in privacy mode).
    } finally {
      hasRestoredFromStorage.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasRestoredFromStorage.current) {
      return;
    }

    try {
      if (logoDataUrl) {
        localStorage.setItem(STORAGE_KEYS.logoDataUrl, logoDataUrl);
      } else {
        localStorage.removeItem(STORAGE_KEYS.logoDataUrl);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [logoDataUrl]);

  useEffect(() => {
    if (!hasRestoredFromStorage.current) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.logoWidth, String(logoWidth));
    } catch {
      // Ignore storage errors.
    }
  }, [logoWidth]);

  useEffect(() => {
    if (!hasRestoredFromStorage.current) {
      return;
    }

    try {
      if (from) {
        localStorage.setItem(STORAGE_KEYS.from, from);
      } else {
        localStorage.removeItem(STORAGE_KEYS.from);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [from]);

  const resizeState = useRef<{
    startX: number;
    startWidth: number;
    pointerId: number;
  } | null>(null);

  const startLogoResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    resizeState.current = {
      startX: event.clientX,
      startWidth: logoWidth,
      pointerId: event.pointerId,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveLogoResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - state.startX;
    const nextWidth = Math.min(
      MAX_LOGO_WIDTH,
      Math.max(MIN_LOGO_WIDTH, Math.round(state.startWidth + deltaX)),
    );
    setLogoWidth(nextWidth);
  };

  const endLogoResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }

    event.preventDefault();
    resizeState.current = null;
  };

  const openLogoPicker = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-logo-resize-handle="true"]')) {
      return;
    }

    logoInputRef.current?.click();
  };

  useEffect(() => {
    if (!logoDataUrl) {
      setLogoAspectRatio(DEFAULT_LOGO_ASPECT_RATIO);
      return;
    }

    let isCancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (isCancelled) {
        return;
      }

      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const ratio = img.naturalHeight / img.naturalWidth;
        if (Number.isFinite(ratio) && ratio > 0) {
          setLogoAspectRatio(ratio);
        }
      }
    };
    img.src = logoDataUrl;

    return () => {
      isCancelled = true;
    };
  }, [logoDataUrl]);

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
    if (!exportInvoiceRef.current || isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");

      const node = exportInvoiceRef.current;

      const rect = node.getBoundingClientRect();
      const nodeWidth = Math.ceil(rect.width);
      const nodeHeight = Math.ceil(rect.height);
      if (!nodeWidth || !nodeHeight) {
        throw new Error("Unable to calculate invoice dimensions.");
      }

      // `html-to-image` renders to a canvas; very large pixel dimensions can be
      // clipped by browser canvas limits. Keep the scale to a safe integer.
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

      const safeInvoiceNumber =
        typeof invoiceNumber === "string" ? invoiceNumber.trim() : "";
      const safeFileName = safeInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, "-");
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filePrefix}-${safeFileName || filePrefix}.pdf`;
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
      <main className="mx-auto w-full max-w-6xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-4 print:shadow-none">
        <div className="mb-6 flex items-center justify-end">
          <label className="no-print mr-3 text-sm font-semibold text-slate-600">
            Type
          </label>
          <select
            className="no-print mr-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
            value={documentType}
            onChange={(event) =>
              setDocumentType(event.target.value as DocumentType)
            }
          >
            <option value="invoice">Invoice</option>
            <option value="quote">Quote</option>
            <option value="proforma">Proforma Invoice</option>
          </select>
          <button
            type="button"
            onClick={exportInvoice}
            disabled={isExporting}
            className="no-print rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExporting ? "Generating PDF..." : `Export ${documentTitle}`}
          </button>
        </div>
        {exportError ? (
          <p className="mb-4 text-right text-sm text-red-600">{exportError}</p>
        ) : null}

        <div ref={invoiceRef}>
          <section className="grid gap-6 md:grid-cols-[1fr_280px]">
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) =>
                  uploadLogo(event.target.files?.[0] ?? null)
                }
              />
              <button
                type="button"
                onClick={openLogoPicker}
                className="relative mb-4 flex items-center justify-center rounded border border-slate-300 bg-slate-50 text-slate-400"
                style={{ width: logoWidth, height: logoHeight }}
              >
                {logoDataUrl ? (
                  <Image
                    src={logoDataUrl}
                    alt="Company logo"
                    width={logoWidth}
                    height={logoHeight}
                    unoptimized
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="font-semibold">+ Add Your Logo</span>
                )}

                {logoDataUrl ? (
                  <div
                    className="no-print absolute bottom-1 right-1 h-4 w-4 rounded border border-slate-300 bg-white/80"
                    data-logo-resize-handle="true"
                    style={{ cursor: "se-resize", touchAction: "none" }}
                    onPointerDown={startLogoResize}
                    onPointerMove={moveLogoResize}
                    onPointerUp={endLogoResize}
                    onPointerCancel={endLogoResize}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                ) : null}
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
                {documentTitle}
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
                  <label className="text-right text-slate-500">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
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
                      handleItemChange(
                        item.id,
                        "description",
                        event.target.value,
                      )
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

              {showPayments ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-slate-500">Amount Paid</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountPaid}
                      onChange={(event) =>
                        setAmountPaid(
                          Math.max(0, Number(event.target.value) || 0),
                        )
                      }
                      className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
                    <span className="font-semibold text-slate-700">
                      Balance Due
                    </span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(balanceDue)}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>

        {/* Export-only render (plain text, no inputs). Kept off-screen but in DOM for html-to-image. */}
        <div className="export-only" aria-hidden="true">
          <div
            ref={exportInvoiceRef}
            className="w-[794px] bg-white p-10 text-slate-700"
          >
            <div className="mb-8 flex items-start justify-between gap-8">
              <div className="min-w-0">
                {logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoDataUrl}
                    alt="Company logo"
                    className="mb-4 object-contain"
                    style={{ width: logoWidth, height: logoHeight }}
                  />
                ) : null}

                {safeFrom ? (
                  <>
                    <div className="text-sm font-semibold text-slate-500">
                      From
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-slate-800">
                      {safeFrom}
                    </div>
                  </>
                ) : null}

                {safeBillTo || safeShipTo ? (
                  <div
                    className={`mt-5 grid gap-6 ${
                      safeBillTo && safeShipTo ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    {safeBillTo ? (
                      <div>
                        <div className="text-sm font-semibold text-slate-500">
                          Bill To
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-800">
                          {safeBillTo}
                        </div>
                      </div>
                    ) : null}
                    {safeShipTo ? (
                      <div>
                        <div className="text-sm font-semibold text-slate-500">
                          Ship To
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-slate-800">
                          {safeShipTo}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="w-72 shrink-0">
                <div className="text-right text-4xl font-light tracking-wide text-slate-900">
                  {documentTitle}
                </div>

                <div className="mt-5 space-y-2 text-sm">
                  {safeInvoiceNumber ? (
                    <div className="flex items-baseline justify-between gap-6">
                      <span className="font-semibold text-slate-500">#</span>
                      <span className="text-right text-slate-800">
                        {safeInvoiceNumber}
                      </span>
                    </div>
                  ) : null}
                  {invoiceDate ? (
                    <div className="flex items-baseline justify-between gap-6">
                      <span className="font-semibold text-slate-500">Date</span>
                      <span className="text-right text-slate-800">
                        {invoiceDate}
                      </span>
                    </div>
                  ) : null}
                  {dueDate ? (
                    <div className="flex items-baseline justify-between gap-6">
                      <span className="font-semibold text-slate-500">
                        Due Date
                      </span>
                      <span className="text-right text-slate-800">
                        {dueDate}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {exportItems.length ? (
              <div className="overflow-hidden rounded border border-slate-200">
                <div className="grid grid-cols-[1fr_90px_120px_120px] bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                  <div>Item</div>
                  <div className="text-right">Quantity</div>
                  <div className="text-right">Rate</div>
                  <div className="text-right">Amount</div>
                </div>

                {exportItems.map((item, index) => {
                  const amount = item.quantity * item.rate;
                  const safeDescription = item.description.trim();

                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[1fr_90px_120px_120px] items-start gap-2 border-t border-slate-200 px-4 py-3 text-sm ${
                        index % 2 === 0 ? "bg-white" : "bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0 whitespace-pre-wrap text-slate-800">
                        {safeDescription}
                      </div>
                      <div className="text-right text-slate-800">
                        {item.quantity}
                      </div>
                      <div className="text-right text-slate-800">
                        {formatCurrency(item.rate)}
                      </div>
                      <div className="text-right font-semibold text-slate-700">
                        {formatCurrency(amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div
              className={`mt-8 grid gap-8 ${
                safeNotes || safeTerms ? "md:grid-cols-[1.3fr_1fr]" : ""
              }`}
            >
              {safeNotes || safeTerms ? (
                <div>
                  {safeNotes ? (
                    <>
                      <div className="text-sm font-semibold text-slate-500">
                        Notes
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {safeNotes}
                      </div>
                    </>
                  ) : null}

                  {safeTerms ? (
                    <>
                      <div className="mt-6 text-sm font-semibold text-slate-500">
                        Terms
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {safeTerms}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between text-base">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="font-semibold text-slate-800">
                    {formatCurrency(subtotal)}
                  </span>
                </div>

                {tax !== 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tax</span>
                    <span className="text-slate-800">
                      {formatCurrency(tax)}
                    </span>
                  </div>
                ) : null}

                {discount !== 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Discount</span>
                    <span className="text-slate-800">
                      {formatCurrency(discount)}
                    </span>
                  </div>
                ) : null}

                {shipping !== 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Shipping</span>
                    <span className="text-slate-800">
                      {formatCurrency(shipping)}
                    </span>
                  </div>
                ) : null}

                <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(total)}
                  </span>
                </div>

                {showPayments && amountPaid !== 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Amount Paid</span>
                    <span className="text-slate-800">
                      {formatCurrency(amountPaid)}
                    </span>
                  </div>
                ) : null}

                {showPayments ? (
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
                    <span className="font-semibold text-slate-700">
                      Balance Due
                    </span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(balanceDue)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
