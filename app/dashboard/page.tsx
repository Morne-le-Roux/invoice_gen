"use client";

import { useAuth } from "@/context/AuthContext";
import {
  generateInvoicePdfBase64,
  generateInvoicePreviewDataUri,
} from "@/lib/generate-invoice-pdf";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";
import type { DocumentType } from "@/types/invoice";
import type { RecurringRecord } from "@/types/recurring";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-indigo-100 text-indigo-700",
  paid: "bg-emerald-100 text-emerald-700",
};

const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-indigo-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-pink-500",
  "bg-teal-500",
];

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getClientName(rec: RecordModel & InvoiceRecord): string {
  const expanded = (rec.expand as Record<string, RecordModel> | undefined)?.[
    "client"
  ];
  const expandName = expanded?.["client_name"] as string | undefined;
  if (expandName) return expandName;
  const firstLine = (rec.bill_to ?? "").split("\n")[0].trim();
  return firstLine || "—";
}

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  quote: "Quote",
  proforma: "Proforma",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(value);
}

function calcTotal(record: InvoiceRecord): number {
  const subtotal = record.items.reduce(
    (sum, item) => sum + item.quantity * item.rate,
    0,
  );
  return Math.max(0, subtotal + record.tax - record.discount + record.shipping);
}

export default function DashboardPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clients, setClients] = useState<Map<string, ClientRecord>>(new Map());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  const [previewDataUri, setPreviewDataUri] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [upcomingRecurring, setUpcomingRecurring] = useState<RecurringRecord[]>(
    [],
  );
  const [emailModal, setEmailModal] = useState<{
    id: string;
    invoiceNumber: string;
    email: string;
    alreadySent: boolean;
  } | null>(null);

  // Redirect to login if unauthenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchInvoices = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [records, clientRecords, recurringRecords] = await Promise.all([
        pb
          .collection("invoices")
          .getFullList({ sort: "-created", expand: "client" }),
        pb
          .collection("clients")
          .getFullList({ sort: "client_name" })
          .catch(() => [] as RecordModel[]),
        pb
          .collection("recurring_invoices")
          .getFullList({
            filter: "active = true",
            sort: "next_run_date",
            expand: "client",
          })
          .catch(() => [] as RecordModel[]),
      ]);
      setInvoices(records as unknown as InvoiceRecord[]);
      const map = new Map<string, ClientRecord>();
      for (const c of clientRecords) {
        if (c.id) map.set(c.id, c as unknown as ClientRecord);
      }
      setClients(map);
      setUpcomingRecurring(
        recurringRecords.slice(0, 5) as unknown as RecurringRecord[],
      );
    } catch (err) {
      console.error("Failed to fetch invoices", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchInvoices();
  }, [user, fetchInvoices]);

  async function handleDelete(id: string) {
    try {
      await pb.collection("invoices").delete(id);
      setInvoices((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete invoice", err);
    } finally {
      setDeleteId(null);
    }
  }

  async function handleStatusChange(id: string, status: InvoiceStatus) {
    try {
      await pb.collection("invoices").update(id, { status });
      setInvoices((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } catch (err) {
      console.error("Failed to update status", err);
    }
  }

  async function handleDocTypeChange(id: string, document_type: DocumentType) {
    try {
      await pb.collection("invoices").update(id, { document_type });
      setInvoices((prev) =>
        prev.map((r) => (r.id === id ? { ...r, document_type } : r)),
      );
    } catch (err) {
      console.error("Failed to update document type", err);
    }
  }

  function openSendModal(rec: RecordModel & InvoiceRecord) {
    setSendError("");
    // Prefer expand data, then look up in clients map, then legacy field
    const expandEmail = (
      rec.expand as Record<string, RecordModel> | undefined
    )?.["client"]?.["email"] as string | undefined;
    const clientMapEmail = rec.client
      ? clients.get(rec.client)?.email
      : undefined;
    const email = expandEmail ?? clientMapEmail ?? rec.client_email ?? "";
    setEmailModal({
      id: rec.id!,
      invoiceNumber: rec.invoice_number,
      email,
      alreadySent: rec.status === "sent" || rec.status === "paid",
    });

    // Generate PDF preview
    setPreviewDataUri(null);
    setPreviewSize(null);
    setPreviewLoading(true);
    const invoice = invoices.find((r) => r.id === rec.id);
    if (invoice) {
      generateInvoicePreviewDataUri(invoice)
        .then(({ dataUri, width, height }) => {
          setPreviewDataUri(dataUri);
          setPreviewSize({ width, height });
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    } else {
      setPreviewLoading(false);
    }
  }

  async function handleSendEmail() {
    await handleSendEmailVariant("standard");
  }

  async function handleSendEmailVariant(emailType: "standard" | "late") {
    if (!emailModal) return;
    const email = emailModal.email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSendError("Please enter a valid email address.");
      return;
    }
    const invoice = invoices.find((r) => r.id === emailModal.id);
    if (!invoice) return;
    setSendingId(emailModal.id);
    setSendError("");
    try {
      const pdfBase64 = await generateInvoicePdfBase64(invoice);
      const res = await fetch("/api/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice,
          recipientEmail: email,
          pdfBase64,
          emailType,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to send email.");
      await pb.collection("invoices").update(emailModal.id, {
        status: "sent",
      });
      setInvoices((prev) =>
        prev.map((r) =>
          r.id === emailModal.id ? { ...r, status: "sent" } : r,
        ),
      );
      setEmailModal(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSendingId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  const totalBilled = invoices
    .filter(
      (r) =>
        r.status === "paid" ||
        ((r as InvoiceRecord).document_type !== "quote" &&
          (r as InvoiceRecord).document_type !== "proforma"),
    )
    .reduce((s, r) => s + calcTotal(r as InvoiceRecord), 0);
  const totalPaid = invoices
    .filter((r) => r.status === "paid")
    .reduce((s, r) => s + calcTotal(r as InvoiceRecord), 0);
  const totalOutstanding = invoices
    .filter(
      (r) =>
        r.status !== "paid" &&
        (r as InvoiceRecord).document_type !== "quote" &&
        (r as InvoiceRecord).document_type !== "proforma",
    )
    .reduce((s, r) => s + calcTotal(r as InvoiceRecord), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Nav */}
      <header className="bg-slate-900">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-8">
              <span className="text-white font-bold tracking-tight">
                DisNetDev
              </span>
              <nav className="flex items-center gap-1">
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10">
                  Invoices
                </span>
                <Link
                  href="/clients"
                  className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Clients
                </Link>
                <Link
                  href="/services"
                  className="px-3 py-1.5 rounded-md text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Services
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">{user.email}</span>
              <Link
                href="/new"
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
              >
                <span className="text-base leading-none">+</span> New Invoice
              </Link>
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

      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Invoices</h1>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: "Total Invoices",
              value: String(invoices.length),
              accent: "text-slate-800",
            },
            {
              label: "Total Billed",
              value: formatCurrency(totalBilled),
              accent: "text-slate-800",
            },
            {
              label: "Paid",
              value: formatCurrency(totalPaid),
              accent: "text-emerald-600",
            },
            {
              label: "Outstanding",
              value: formatCurrency(totalOutstanding),
              accent: "text-amber-600",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl bg-white border border-slate-200 px-5 py-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
                {s.label}
              </p>
              <p className={`text-xl font-bold ${s.accent}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Upcoming Recurring Invoices */}
        {upcomingRecurring.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Upcoming Recurring Invoices
              </h2>
              <Link
                href="/recurring"
                className="text-xs text-indigo-600 hover:text-indigo-500 transition-colors"
              >
                View all
              </Link>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Client
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Frequency
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Next Date
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {upcomingRecurring.map((rec) => {
                    const clientName =
                      rec.expand?.client?.client_name ||
                      (rec.bill_to ?? "").split("\n")[0].trim() ||
                      "—";
                    const initials = getInitials(clientName);
                    const avatarBg = avatarColor(clientName);
                    const amount = rec.items.reduce(
                      (sum, item) => sum + item.quantity * item.rate,
                      0,
                    );
                    const total = Math.max(
                      0,
                      amount + rec.tax - rec.discount + rec.shipping,
                    );
                    const nextDate = rec.next_run_date
                      ? new Date(rec.next_run_date).toLocaleDateString(
                          "en-ZA",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          },
                        )
                      : "—";
                    const daysUntil = rec.next_run_date
                      ? Math.ceil(
                          (new Date(rec.next_run_date).getTime() - Date.now()) /
                            (1000 * 60 * 60 * 24),
                        )
                      : null;
                    return (
                      <tr
                        key={rec.id}
                        onClick={() =>
                          router.push(`/recurring/new?id=${rec.id}`)
                        }
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                            >
                              {initials}
                            </div>
                            <span className="font-medium text-slate-700 truncate max-w-35">
                              {clientName}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="capitalize text-slate-500">
                            {rec.frequency}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-700">{nextDate}</span>
                            {daysUntil !== null &&
                              daysUntil >= 0 &&
                              daysUntil <= 7 && (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  {daysUntil === 0 ? "Today" : `${daysUntil}d`}
                                </span>
                              )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="font-semibold text-slate-800">
                            {formatCurrency(total)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-slate-400">Loading invoices…</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 rounded-2xl bg-white border border-slate-200">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <svg
                className="w-7 h-7 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-slate-500 text-sm mb-5">No invoices yet.</p>
            <Link
              href="/new"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              + Create your first invoice
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Invoice
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Client
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Amount
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {invoices.map((r) => {
                  const rec = r as RecordModel & InvoiceRecord;
                  const recordId = r.id!;
                  const clientName = getClientName(rec);
                  const initials = getInitials(clientName);
                  const avatarBg = avatarColor(clientName);
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-sm font-medium text-slate-700">
                          {rec.invoice_number || (
                            <span className="text-slate-300">—</span>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                          >
                            {initials}
                          </div>
                          <span className="font-medium text-slate-700 truncate max-w-35">
                            {clientName !== "—" ? (
                              clientName
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500">
                        {rec.invoice_date || (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <select
                          value={rec.document_type}
                          onChange={(e) =>
                            handleDocTypeChange(
                              r.id!,
                              e.target.value as DocumentType,
                            )
                          }
                          className="text-xs font-medium rounded-full px-2.5 py-1 border border-slate-200 cursor-pointer bg-slate-50 text-slate-600 hover:bg-slate-100 outline-none transition-colors"
                        >
                          {Object.entries(DOC_TYPE_LABELS).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(calcTotal(rec))}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <select
                          value={rec.status}
                          onChange={(e) =>
                            handleStatusChange(
                              r.id!,
                              e.target.value as InvoiceStatus,
                            )
                          }
                          className={`text-xs font-semibold rounded-full px-2.5 py-1 border-0 cursor-pointer outline-none transition-colors ${STATUS_COLORS[rec.status as InvoiceStatus] ?? ""}`}
                        >
                          {(Object.keys(STATUS_LABELS) as InvoiceStatus[]).map(
                            (s) => (
                              <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {deleteId === recordId ? (
                            <>
                              <button
                                onClick={() => handleDelete(recordId)}
                                className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteId(null)}
                                className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              {rec.status !== "sent" &&
                                rec.status !== "paid" && (
                                  <Link
                                    href={`/new?id=${recordId}`}
                                    className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                                  >
                                    Edit
                                  </Link>
                                )}
                              <button
                                onClick={() => openSendModal(rec)}
                                disabled={sendingId === recordId}
                                className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                              >
                                {rec.status === "sent" || rec.status === "paid"
                                  ? "Resend"
                                  : "Send"}
                              </button>
                              <button
                                onClick={() => setDeleteId(recordId)}
                                className="inline-flex items-center rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Email send modal */}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-6xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 flex flex-col max-h-[95vh]">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                {emailModal.alreadySent ? "Resend Invoice" : "Send Invoice"}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {emailModal.alreadySent
                  ? `Resend invoice #${emailModal.invoiceNumber} to client.`
                  : `Send invoice #${emailModal.invoiceNumber} to client.`}
              </p>
            </div>

            {/* PDF Preview */}
            <div
              className="mb-4 rounded-xl overflow-auto border border-slate-200 bg-slate-50 flex-1 min-h-0"
              style={{ height: "72vh", minHeight: "32rem" }}
            >
              {previewLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">
                  Generating preview…
                </div>
              ) : previewDataUri ? (
                <div className="flex min-h-full items-start justify-center p-4">
                  <Image
                    src={previewDataUri}
                    alt="Invoice preview"
                    width={previewSize?.width ?? 794}
                    height={previewSize?.height ?? 1123}
                    unoptimized
                    sizes="(max-width: 1024px) 100vw, 1200px"
                    className="block h-auto w-full rounded-lg bg-white shadow-sm"
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">
                  Preview unavailable
                </div>
              )}
            </div>
            <div className="space-y-1 mb-4">
              <label className="block text-sm font-medium text-slate-700">
                Recipient email
              </label>
              <input
                type="email"
                value={emailModal.email}
                onChange={(e) =>
                  setEmailModal((m) =>
                    m ? { ...m, email: e.target.value } : m,
                  )
                }
                onKeyDown={(e) =>
                  e.key === "Enter" && handleSendEmailVariant("standard")
                }
                placeholder="client@example.com"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
                autoFocus
              />
            </div>
            {sendError && (
              <p className="text-sm text-red-600 mb-3">{sendError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEmailModal(null)}
                className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSendEmailVariant("late")}
                disabled={sendingId === emailModal.id}
                className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60"
              >
                {sendingId === emailModal.id ? "Sending…" : "Send Late Notice"}
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingId === emailModal.id}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60"
              >
                {sendingId === emailModal.id
                  ? "Sending…"
                  : emailModal.alreadySent
                    ? "Resend"
                    : "Send Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
