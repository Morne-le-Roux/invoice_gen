"use client";

import { useAuth } from "@/context/AuthContext";
import { generateInvoicePdfBase64 } from "@/lib/generate-invoice-pdf";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";
import type { DocumentType } from "@/types/invoice";
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
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};

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
  const [invoices, setInvoices] = useState<RecordModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clients, setClients] = useState<Map<string, ClientRecord>>(new Map());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
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
      const [records, clientRecords] = await Promise.all([
        pb
          .collection("invoices")
          .getFullList({ sort: "-created", expand: "client" }),
        pb
          .collection("clients")
          .getFullList({ sort: "client_name" })
          .catch(() => [] as RecordModel[]),
      ]);
      setInvoices(records);
      const map = new Map<string, ClientRecord>();
      for (const c of clientRecords) {
        if (c.id) map.set(c.id, c as unknown as ClientRecord);
      }
      setClients(map);
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
  }

  async function handleSendEmail() {
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
      const pdfBase64 = await generateInvoicePdfBase64(
        invoice as InvoiceRecord,
      );
      const res = await fetch("/api/send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice, recipientEmail: email, pdfBase64 }),
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
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Invoices</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user.email}</span>
          <Link
            href="/clients"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Clients
          </Link>
          <Link
            href="/"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            + New Invoice
          </Link>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {isLoading ? (
          <p className="text-sm text-gray-400">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm mb-4">No invoices yet.</p>
            <Link
              href="/"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors"
            >
              Create your first invoice
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wide">
                  <th className="px-5 py-3">Number</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((r) => {
                  const rec = r as RecordModel & InvoiceRecord;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-5 py-3 font-mono text-gray-700">
                        {rec.invoice_number}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        <select
                          value={rec.document_type}
                          onChange={(e) =>
                            handleDocTypeChange(
                              r.id,
                              e.target.value as DocumentType,
                            )
                          }
                          className="text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer bg-gray-100 text-gray-600"
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
                      <td className="px-5 py-3 text-gray-700">
                        {rec.bill_to || (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {rec.invoice_date || (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-gray-800">
                        {formatCurrency(calcTotal(rec))}
                      </td>
                      <td className="px-5 py-3">
                        <select
                          value={rec.status}
                          onChange={(e) =>
                            handleStatusChange(
                              r.id,
                              e.target.value as InvoiceStatus,
                            )
                          }
                          className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[rec.status as InvoiceStatus] ?? ""}`}
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
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          {deleteId === r.id ? (
                            <>
                              <button
                                onClick={() => handleDelete(r.id)}
                                className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteId(null)}
                                className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              {rec.status !== "sent" &&
                                rec.status !== "paid" && (
                                  <Link
                                    href={`/?id=${r.id}`}
                                    className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                                  >
                                    Edit
                                  </Link>
                                )}
                              <button
                                onClick={() => openSendModal(rec)}
                                disabled={sendingId === r.id}
                                className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {rec.status === "sent" || rec.status === "paid"
                                  ? "Resend"
                                  : "Send"}
                              </button>
                              <button
                                onClick={() => setDeleteId(r.id)}
                                className="inline-flex items-center rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              {emailModal.alreadySent ? "Resend Invoice" : "Send Invoice"}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {emailModal.alreadySent
                ? `Resend invoice #${emailModal.invoiceNumber} to client.`
                : `Send invoice #${emailModal.invoiceNumber} to client.`}
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client email address
            </label>
            <input
              type="email"
              value={emailModal.email}
              onChange={(e) =>
                setEmailModal((m) => (m ? { ...m, email: e.target.value } : m))
              }
              onKeyDown={(e) => e.key === "Enter" && handleSendEmail()}
              placeholder="client@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-3"
              autoFocus
            />
            {sendError && (
              <p className="text-sm text-red-600 mb-3">{sendError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEmailModal(null)}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingId === emailModal.id}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {sendingId === emailModal.id
                  ? "Sending…"
                  : emailModal.alreadySent
                    ? "Resend"
                    : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
