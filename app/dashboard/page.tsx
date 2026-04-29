"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice";
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
      const records = await pb.collection("invoices").getFullList({
        filter: `user = "${user.id}"`,
        sort: "-created",
      });
      setInvoices(records);
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
                        {DOC_TYPE_LABELS[rec.document_type] ??
                          rec.document_type}
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
                        <div className="flex items-center gap-2 justify-end">
                          <Link
                            href={`/?id=${r.id}`}
                            className="text-blue-600 hover:underline text-xs"
                          >
                            Edit
                          </Link>
                          {deleteId === r.id ? (
                            <>
                              <button
                                onClick={() => handleDelete(r.id)}
                                className="text-red-600 hover:underline text-xs"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteId(null)}
                                className="text-gray-400 hover:underline text-xs"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteId(r.id)}
                              className="text-gray-400 hover:text-red-500 text-xs transition-colors"
                            >
                              Delete
                            </button>
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
    </div>
  );
}
