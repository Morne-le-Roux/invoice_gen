"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import type { InvoiceRecord } from "@/types/invoice";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type InvoiceItem = {
  id: number;
  description: string;
  quantity: number;
  rate: number;
};

type DocumentType = "invoice" | "quote" | "proforma";

const STORAGE_KEYS = {
  from: "invoice_gen.from",
} as const;

const toDocumentPrefix = (value: string) => {
  const lettersOnly = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return lettersOnly.slice(0, 3).padEnd(3, "X");
};

const generateInvoiceNumber = (existing: string, prefix: string) => {
  // Keep the same number if it already matches PREFIX-MMDD-NNN to avoid churn on re-renders
  if (/^[A-Z]{3}-\d{4}-\d{3}$/.test(existing.trim())) {
    // Only regenerate if the prefix has changed
    if (existing.trim().startsWith(prefix + "-")) {
      return existing.trim();
    }
  }

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(100 + Math.random() * 900));
  return `${prefix}-${mm}${dd}-${rand}`;
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
  const hasRestoredFromStorage = useRef(false);

  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [invoiceNumber, setInvoiceNumber] = useState("1");
  const [isInvoiceNumberAuto, setIsInvoiceNumberAuto] = useState(true);
  const [from, setFrom] = useState("");
  const [billTo, setBillTo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [tax, setTax] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [amountPaid, setAmountPaid] = useState(0);
  const [clientEmail, setClientEmail] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const selectedClientIdRef = useRef<string | null>(null);
  selectedClientIdRef.current = selectedClientId;
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(
    null,
  );
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // PocketBase save/load state
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

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
  const safeInvoiceNumber = invoiceNumber.trim();
  const prefixSource = selectedClient?.client_name ?? safeBillTo;
  const safeNotes = notes.trim();
  const safeTerms = terms.trim();

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
    if (!isInvoiceNumberAuto) {
      return;
    }

    const prefix = toDocumentPrefix(prefixSource);
    setInvoiceNumber((prev) => generateInvoiceNumber(prev, prefix));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInvoiceNumberAuto, prefixSource]);

  useEffect(() => {
    if (hasRestoredFromStorage.current) {
      return;
    }

    try {
      const storedFrom = localStorage.getItem(STORAGE_KEYS.from);

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
      if (from) {
        localStorage.setItem(STORAGE_KEYS.from, from);
      } else {
        localStorage.removeItem(STORAGE_KEYS.from);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [from]);

  // Load clients
  useEffect(() => {
    if (!user) return;
    pb.collection("clients")
      .getFullList({
        sort: "client_name",
      })
      .then((records) => setClients(records as unknown as ClientRecord[]))
      .catch(() => {}); // Collection may not exist yet
  }, [user]);

  // Sync selectedClient when clients list or selectedClientId changes
  useEffect(() => {
    if (!selectedClientId || clients.length === 0) return;
    const c = clients.find((c) => c.id === selectedClientId);
    if (c) setSelectedClient(c);
  }, [selectedClientId, clients]);

  // Load invoice from ?id= query param
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !user) return;

    pb.collection("invoices")
      .getOne(id)
      .then((record) => {
        setSavedId(record.id);
        setDocumentType(record.document_type);
        setInvoiceNumber(record.invoice_number ?? "");
        setFrom(record.from_details ?? "");
        setBillTo(record.bill_to ?? "");
        setInvoiceDate(record.invoice_date ?? "");
        setDueDate(record.due_date ?? "");
        setNotes(record.notes ?? "");
        setTerms(record.terms ?? "");
        setTax(record.tax ?? 0);
        setDiscount(record.discount ?? 0);
        setShipping(record.shipping ?? 0);
        setAmountPaid(record.amount_paid ?? 0);
        const expandedClient = (
          record.expand as InvoiceRecord["expand"] | undefined
        )?.client;
        setSelectedClientId(record.client ?? null);
        setClientEmail(expandedClient?.email ?? record.client_email ?? "");
        if (Array.isArray(record.items)) setItems(record.items);
      })
      .catch((err) => console.error("Failed to load invoice", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const saveInvoice = useCallback(async () => {
    if (!user || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const data = {
      user: user.id,
      document_type: documentType,
      invoice_number: invoiceNumber.trim(),
      from_details: from,
      bill_to: billTo,
      invoice_date: invoiceDate,
      due_date: dueDate,
      notes,
      terms,
      tax,
      discount,
      shipping,
      amount_paid: amountPaid,
      items,
      status: "draft",
      client: selectedClientIdRef.current || null,
    };

    try {
      if (savedId) {
        await pb.collection("invoices").update(savedId, data);
      } else {
        const record = await pb.collection("invoices").create(data);
        setSavedId(record.id);
        window.history.replaceState(null, "", `/?id=${record.id}`);
      }
      router.push("/dashboard");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }, [
    user,
    isSaving,
    savedId,
    documentType,
    invoiceNumber,
    from,
    billTo,
    invoiceDate,
    dueDate,
    notes,
    terms,
    tax,
    discount,
    shipping,
    amountPaid,
    items,
  ]);

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

      // Save/update the invoice in the DB as "sent" then go to dashboard
      if (user) {
        const data = {
          user: user.id,
          document_type: documentType,
          invoice_number: invoiceNumber.trim(),
          from_details: from,
          bill_to: billTo,
          invoice_date: invoiceDate,
          due_date: dueDate,
          notes,
          terms,
          tax,
          discount,
          shipping,
          amount_paid: amountPaid,
          items,
          status: "sent",
          client: selectedClientIdRef.current || null,
        };
        if (savedId) {
          await pb.collection("invoices").update(savedId, data);
        } else {
          const record = await pb.collection("invoices").create(data);
          setSavedId(record.id);
        }
        router.push("/dashboard");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invoice export failed.";
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-700 print:bg-white print:p-0">
      {/* Top nav */}
      <header className="no-print bg-slate-900 print:hidden">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <span className="text-white font-bold tracking-tight">
                DisNetDev
              </span>
              {user && (
                <nav className="flex items-center gap-1">
                  <Link
                    href="/dashboard"
                    className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Invoices
                  </Link>
                  <Link
                    href="/clients"
                    className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Clients
                  </Link>
                  <Link
                    href="/recurring"
                    className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Recurring
                  </Link>
                </nav>
              )}
            </div>
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  <span className="text-sm text-slate-400">{user.email}</span>
                  <button
                    type="button"
                    onClick={logout}
                    className="text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-lg border border-slate-600 px-3.5 py-1.5 text-sm text-slate-300 hover:border-slate-400 hover:text-white transition-colors"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 py-8 sm:px-8">
        <main className="mx-auto w-full max-w-6xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-4 print:shadow-none">
          <div className="mb-6 flex items-center justify-end">
            <label className="no-print mr-3 text-sm font-semibold text-slate-600">
              Type
            </label>
            <select
              className="no-print mr-4 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
              value={documentType}
              onChange={async (event) => {
                const next = event.target.value as DocumentType;
                setDocumentType(next);
                if (savedId) {
                  try {
                    await pb
                      .collection("invoices")
                      .update(savedId, { document_type: next });
                  } catch {
                    // Non-critical — type is still updated locally
                  }
                }
              }}
            >
              <option value="invoice">Invoice</option>
              <option value="quote">Quote</option>
              <option value="proforma">Proforma Invoice</option>
            </select>
            {user ? (
              <button
                type="button"
                onClick={saveInvoice}
                disabled={isSaving}
                className="no-print rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save as Draft"}
              </button>
            ) : null}
          </div>
          {exportError ? (
            <p className="mb-4 text-right text-sm text-red-600">
              {exportError}
            </p>
          ) : null}
          {saveError ? (
            <p className="no-print mb-4 text-right text-sm text-red-600">
              {saveError}
            </p>
          ) : null}

          <div ref={invoiceRef}>
            <section className="grid gap-6 md:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-4">
                  <Image
                    src="/DisNetDev Software.svg"
                    alt="DisNetDev Software logo"
                    width={320}
                    height={107}
                    className="w-full object-contain"
                  />
                </div>

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

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-500">
                    Bill To
                  </label>

                  {/* Client search (editor only, not printed) */}
                  <div className="no-print relative mb-2">
                    {selectedClient ? (
                      <div className="flex items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
                        <span className="flex-1 text-sm font-medium text-slate-700">
                          {selectedClient.client_name}
                        </span>
                        {selectedClient.email && (
                          <span className="text-xs text-slate-400">
                            {selectedClient.email}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClient(null);
                            setSelectedClientId(null);
                            setClientSearch("");
                          }}
                          className="ml-1 text-slate-400 hover:text-slate-600 text-sm leading-none"
                          aria-label="Clear client"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="text"
                          value={clientSearch}
                          onChange={(e) => {
                            setClientSearch(e.target.value);
                            setShowClientDropdown(true);
                          }}
                          onFocus={() => setShowClientDropdown(true)}
                          onBlur={() =>
                            setTimeout(() => setShowClientDropdown(false), 150)
                          }
                          placeholder="Search clients…"
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                        {showClientDropdown && (
                          <div className="absolute z-20 mt-1 w-full rounded border border-slate-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                            {clients
                              .filter(
                                (c) =>
                                  !clientSearch ||
                                  c.client_name
                                    .toLowerCase()
                                    .includes(clientSearch.toLowerCase()) ||
                                  c.email
                                    .toLowerCase()
                                    .includes(clientSearch.toLowerCase()),
                              )
                              .map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onMouseDown={() => {
                                    setSelectedClient(c);
                                    setSelectedClientId(c.id ?? null);
                                    setBillTo(c.details);
                                    setClientEmail(c.email);
                                    setClientSearch("");
                                    setShowClientDropdown(false);
                                  }}
                                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                                >
                                  <span className="font-medium text-slate-800">
                                    {c.client_name}
                                  </span>
                                  {c.email && (
                                    <span className="text-xs text-slate-400">
                                      {c.email}
                                    </span>
                                  )}
                                </button>
                              ))}
                            {clients.filter(
                              (c) =>
                                !clientSearch ||
                                c.client_name
                                  .toLowerCase()
                                  .includes(clientSearch.toLowerCase()) ||
                                c.email
                                  .toLowerCase()
                                  .includes(clientSearch.toLowerCase()),
                            ).length === 0 && (
                              <div className="px-3 py-2 text-sm text-slate-400">
                                No clients found.{" "}
                                <Link
                                  href="/clients"
                                  className="text-blue-600 hover:underline"
                                >
                                  Add one?
                                </Link>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <textarea
                    value={billTo}
                    onChange={(event) => setBillTo(event.target.value)}
                    placeholder="Who is this to?"
                    rows={3}
                    className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
                  />
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
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setInvoiceNumber(nextValue);
                      setIsInvoiceNumberAuto(nextValue.trim() === "");
                    }}
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
                      Due Date
                    </label>
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
                        handleItemChange(
                          item.id,
                          "quantity",
                          event.target.value,
                        )
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

            {/* Banking details - always shown at bottom left */}
            <div className="mt-8 border-t border-slate-200 pt-6">
              <div className="text-sm font-semibold text-slate-500">
                Banking Details
              </div>
              <div className="mt-1 text-sm text-slate-800 leading-relaxed">
                <div>Account Holder: DisNetDev</div>
                <div>Account Type: Savings Account</div>
                <div>Discovery Bank</div>
                <div>Branch Code: 679000</div>
                <div>Account Number: 19742778391</div>
              </div>
            </div>
          </div>

          {/* Export-only render (plain text, no inputs). Kept off-screen but in DOM for html-to-image. */}
          <div className="export-only" aria-hidden="true">
            <div
              ref={exportInvoiceRef}
              className="w-[794px] bg-white p-10 text-slate-700"
            >
              <div className="mb-8 flex items-start justify-between gap-8">
                <div className="min-w-0">
                  <img
                    src="/DisNetDev Software.svg"
                    alt="DisNetDev Software logo"
                    className="mb-4 w-full object-contain"
                    style={{ maxWidth: 320 }}
                  />

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

                  {safeBillTo ? (
                    <div className="mt-5">
                      <div className="text-sm font-semibold text-slate-500">
                        Bill To
                      </div>
                      <div className="whitespace-pre-wrap text-sm text-slate-800">
                        {safeBillTo}
                      </div>
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
                        <span className="font-semibold text-slate-500">
                          Date
                        </span>
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

              {/* Banking details - always shown at bottom left */}
              <div className="mt-8 border-t border-slate-200 pt-6">
                <div className="text-sm font-semibold text-slate-500">
                  Banking Details
                </div>
                <div className="mt-1 text-sm text-slate-800 leading-relaxed">
                  <div>Account Holder: DisNetDev</div>
                  <div>Account Type: Savings Account</div>
                  <div>Discovery Bank</div>
                  <div>Branch Code: 679000</div>
                  <div>Account Number: 19742778391</div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
