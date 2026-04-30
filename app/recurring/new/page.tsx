"use client";

import { COMPANY_FROM_DETAILS } from "@/lib/company-details";
import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import type { RecurringFrequency, RecurringRecord } from "@/types/recurring";
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

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

// Default next_run_date = tomorrow
function defaultNextRun(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export default function RecurringNewPage() {
  const selectedClientIdRef = useRef<string | null>(null);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Invoice template fields
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [billTo, setBillTo] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [tax, setTax] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [amountPaid, setAmountPaid] = useState(0);
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: 1, description: "", quantity: 1, rate: 0 },
  ]);

  // Client picker
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(
    null,
  );
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // Recurring-specific
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [nextRunDate, setNextRunDate] = useState(defaultNextRun());
  const [active, setActive] = useState(true);

  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const from = COMPANY_FROM_DETAILS;

  selectedClientIdRef.current = selectedClientId;

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  // Load clients
  useEffect(() => {
    if (!user) return;
    pb.collection("clients")
      .getFullList({ sort: "client_name" })
      .then((recs) => setClients(recs as unknown as ClientRecord[]))
      .catch(() => {});
  }, [user]);

  // Sync selectedClient when list or id changes
  useEffect(() => {
    if (!selectedClientId || clients.length === 0) return;
    const c = clients.find((c) => c.id === selectedClientId);
    if (c) setSelectedClient(c);
  }, [selectedClientId, clients]);

  // Load existing record from ?id= query param
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id || !user) return;

    pb.collection("recurring_invoices")
      .getOne(id, { expand: "client" })
      .then((record) => {
        setSavedId(record.id);
        setDocumentType(record.document_type ?? "invoice");
        setBillTo(record.bill_to ?? "");
        setNotes(record.notes ?? "");
        setTerms(record.terms ?? "");
        setTax(record.tax ?? 0);
        setDiscount(record.discount ?? 0);
        setShipping(record.shipping ?? 0);
        setAmountPaid(record.amount_paid ?? 0);
        if (Array.isArray(record.items)) setItems(record.items);
        setFrequency(record.frequency ?? "monthly");
        setNextRunDate(record.next_run_date ?? defaultNextRun());
        setActive(record.active !== false);
        setSelectedClientId(record.client ?? null);
      })
      .catch((err) => console.error("Failed to load recurring invoice", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.rate, 0),
    [items],
  );
  const total = Math.max(0, subtotal + tax - discount + shipping);
  const balanceDue = Math.max(0, total - amountPaid);

  const documentTitle =
    documentType === "quote"
      ? "QUOTE"
      : documentType === "proforma"
        ? "PROFORMA INVOICE"
        : "INVOICE";

  const showPayments = documentType !== "quote";

  const handleItemChange = (
    id: number,
    key: keyof Omit<InvoiceItem, "id">,
    value: string,
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (key === "description") return { ...item, description: value };
        const parsed = Number(value);
        return {
          ...item,
          [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
        };
      }),
    );
  };

  const addLineItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now(), description: "", quantity: 1, rate: 0 },
    ]);
  };

  const removeLineItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const saveRecurring = useCallback(async () => {
    if (!user || isSaving) return;
    setIsSaving(true);
    setSaveError("");

    const data: Omit<RecurringRecord, "id" | "expand"> = {
      user: user.id,
      document_type: documentType,
      from_details: from,
      bill_to: billTo,
      ship_to: "",
      notes,
      terms,
      tax,
      discount,
      shipping,
      amount_paid: amountPaid,
      items,
      client: selectedClientIdRef.current || undefined,
      frequency,
      next_run_date: nextRunDate,
      active,
      auto_send: false,
    };

    try {
      if (savedId) {
        await pb.collection("recurring_invoices").update(savedId, data);
      } else {
        const record = await pb.collection("recurring_invoices").create(data);
        setSavedId(record.id);
        window.history.replaceState(null, "", `/recurring/new?id=${record.id}`);
      }
      router.push("/recurring");
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
    from,
    billTo,
    notes,
    terms,
    tax,
    discount,
    shipping,
    amountPaid,
    items,
    frequency,
    nextRunDate,
    active,
    router,
  ]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-700">
      {/* Top nav */}
      <header className="bg-slate-900">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <span className="text-white font-bold tracking-tight">
                DisNetDev
              </span>
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
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">{user.email}</span>
              <button
                onClick={logout}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 py-8 sm:px-8">
        <main className="mx-auto w-full max-w-6xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {/* Header row */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-slate-900">
              {savedId ? "Edit Recurring Invoice" : "New Recurring Invoice"}
            </h1>
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-slate-600">
                Type
              </label>
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
                value={documentType}
                onChange={(e) =>
                  setDocumentType(e.target.value as DocumentType)
                }
              >
                <option value="invoice">Invoice</option>
                <option value="quote">Quote</option>
                <option value="proforma">Proforma Invoice</option>
              </select>
              <button
                type="button"
                onClick={saveRecurring}
                disabled={isSaving}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {saveError && (
            <p className="mb-4 text-right text-sm text-red-600">{saveError}</p>
          )}

          {/* Recurring settings banner */}
          <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
            <h2 className="mb-3 text-sm font-semibold text-indigo-800">
              Recurring Settings
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {/* Frequency */}
              <div>
                <label className="mb-1 block text-xs font-medium text-indigo-700">
                  Frequency
                </label>
                <select
                  value={frequency}
                  onChange={(e) =>
                    setFrequency(e.target.value as RecurringFrequency)
                  }
                  className="w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400"
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {/* First / Next run date */}
              <div>
                <label className="mb-1 block text-xs font-medium text-indigo-700">
                  {savedId ? "Next Run Date" : "First Run Date"}
                </label>
                <input
                  type="date"
                  value={nextRunDate}
                  onChange={(e) => setNextRunDate(e.target.value)}
                  className="w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400"
                />
              </div>

              {/* Active toggle */}
              <div className="flex flex-col justify-end">
                <label className="mb-1 block text-xs font-medium text-indigo-700">
                  Active
                </label>
                <button
                  type="button"
                  onClick={() => setActive((a) => !a)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${active ? "bg-indigo-600" : "bg-slate-200"}`}
                  aria-label={active ? "Deactivate" : "Activate"}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${active ? "translate-x-6" : "translate-x-1"}`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Invoice template */}
          <div>
            <section className="grid gap-6 md:grid-cols-[1fr_280px]">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-500">
                  Who is this from?
                </label>
                <textarea
                  value={from}
                  readOnly
                  rows={4}
                  className="mb-5 w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700 outline-none"
                />

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-500">
                    Bill To
                  </label>

                  {/* Client search */}
                  <div className="relative mb-2">
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
                    onChange={(e) => setBillTo(e.target.value)}
                    placeholder="Who is this to?"
                    rows={3}
                    className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div>
                <h1 className="mb-6 text-right text-4xl font-light tracking-wide text-slate-900">
                  {documentTitle}
                </h1>
                <p className="text-right text-xs text-slate-400 italic">
                  Invoice number &amp; dates are assigned automatically on each
                  run.
                </p>
              </div>
            </section>

            {/* Line items */}
            <section className="mt-8 overflow-x-auto">
              <div className="grid min-w-175 grid-cols-[1fr_90px_120px_120px_36px] rounded-t bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                <div>Item</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Rate</div>
                <div className="text-right">Amount</div>
                <div />
              </div>
              {items.map((item, index) => {
                const amount = item.quantity * item.rate;
                return (
                  <div
                    key={item.id}
                    className={`grid min-w-175 grid-cols-[1fr_90px_120px_120px_36px] items-center gap-2 border-x border-b border-slate-200 px-4 py-2 ${
                      index % 2 === 0 ? "bg-white" : "bg-slate-50"
                    }`}
                  >
                    <input
                      value={item.description}
                      onChange={(e) =>
                        handleItemChange(item.id, "description", e.target.value)
                      }
                      placeholder="Description of item/service..."
                      className="rounded border border-slate-300 px-3 py-2 outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={item.quantity}
                      onChange={(e) =>
                        handleItemChange(item.id, "quantity", e.target.value)
                      }
                      className="rounded border border-slate-300 px-3 py-2 text-right outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.rate}
                      onChange={(e) =>
                        handleItemChange(item.id, "rate", e.target.value)
                      }
                      className="rounded border border-slate-300 px-3 py-2 text-right outline-none"
                    />
                    <div className="text-right font-semibold text-slate-600">
                      {formatCurrency(amount)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLineItem(item.id)}
                      disabled={items.length === 1}
                      className="flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors disabled:opacity-20"
                      aria-label="Remove line item"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addLineItem}
                className="mt-3 rounded border border-emerald-500 px-4 py-2 font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                + Line Item
              </button>
            </section>

            {/* Notes / Terms / Totals */}
            <section className="mt-8 grid gap-8 md:grid-cols-[1.3fr_1fr]">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-500">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Notes - any relevant information not already covered"
                  className="mb-6 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-400"
                />
                <label className="mb-2 block text-sm font-semibold text-slate-500">
                  Terms
                </label>
                <textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
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
                    onChange={(e) =>
                      setTax(Math.max(0, Number(e.target.value) || 0))
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
                    onChange={(e) =>
                      setDiscount(Math.max(0, Number(e.target.value) || 0))
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
                    onChange={(e) =>
                      setShipping(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base">
                  <span className="font-semibold text-slate-700">Total</span>
                  <span className="font-bold text-slate-900">
                    {formatCurrency(total)}
                  </span>
                </div>
                {showPayments && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-slate-500">Amount Paid</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={amountPaid}
                        onChange={(e) =>
                          setAmountPaid(
                            Math.max(0, Number(e.target.value) || 0),
                          )
                        }
                        className="w-36 rounded border border-slate-300 px-3 py-2 text-right outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3 text-base text-white">
                      <span className="font-semibold">Balance Due</span>
                      <span className="font-bold">
                        {formatCurrency(balanceDue)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>

          {/* Bottom save */}
          <div className="mt-8 flex justify-end gap-3">
            <Link
              href="/recurring"
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={saveRecurring}
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving
                ? "Saving…"
                : savedId
                  ? "Update"
                  : "Create Recurring Invoice"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
