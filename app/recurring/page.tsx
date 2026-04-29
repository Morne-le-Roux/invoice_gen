"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { RecurringFrequency, RecurringRecord } from "@/types/recurring";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(value);
}

function calcTotal(record: RecurringRecord): number {
  const subtotal = (record.items ?? []).reduce(
    (sum, item) => sum + item.quantity * item.rate,
    0,
  );
  return Math.max(0, subtotal + record.tax - record.discount + record.shipping);
}

function getClientName(rec: RecurringRecord): string {
  const expanded = rec.expand?.client;
  if (expanded?.client_name) return expanded.client_name;
  const firstLine = (rec.bill_to ?? "").split("\n")[0].trim();
  return firstLine || "—";
}

export default function RecurringPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [records, setRecords] = useState<RecordModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchRecords = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const data = await pb
        .collection("recurring_invoices")
        .getFullList({ sort: "next_run_date", expand: "client" });
      setRecords(data);
    } catch (err) {
      console.error("Failed to fetch recurring invoices", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchRecords();
  }, [user, fetchRecords]);

  async function handleDelete(id: string) {
    try {
      await pb.collection("recurring_invoices").delete(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete recurring invoice", err);
    } finally {
      setDeleteId(null);
    }
  }

  async function handleToggleActive(id: string, current: boolean) {
    setTogglingId(id);
    try {
      await pb
        .collection("recurring_invoices")
        .update(id, { active: !current });
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, active: !current } : r)),
      );
    } catch (err) {
      console.error("Failed to toggle recurring invoice", err);
    } finally {
      setTogglingId(null);
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
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10">
                  Recurring
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">{user.email}</span>
              <Link
                href="/recurring/new"
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
              >
                <span className="text-base leading-none">+</span> New Recurring
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
        <h1 className="text-2xl font-bold text-slate-900 mb-6">
          Recurring Invoices
        </h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        ) : records.length === 0 ? (
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
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <p className="text-slate-500 text-sm mb-5">
              No recurring invoices yet.
            </p>
            <Link
              href="/recurring/new"
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              + Create your first recurring invoice
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Client
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Frequency
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Next Run
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Amount
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Auto-send
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Active
                  </th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {records.map((r) => {
                  const rec = r as RecordModel & RecurringRecord;
                  const clientName = getClientName(rec);
                  const initials = getInitials(clientName);
                  const avatarBg = avatarColor(clientName);
                  const isActive = rec.active !== false;
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                          >
                            {initials}
                          </div>
                          <span className="font-medium text-slate-700 truncate max-w-40">
                            {clientName !== "—" ? (
                              clientName
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                          {FREQUENCY_LABELS[
                            rec.frequency as RecurringFrequency
                          ] ?? rec.frequency}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">
                        {rec.next_run_date || (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(calcTotal(rec))}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {rec.auto_send ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => handleToggleActive(r.id, isActive)}
                          disabled={togglingId === r.id}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${isActive ? "bg-indigo-600" : "bg-slate-200"}`}
                          aria-label={isActive ? "Deactivate" : "Activate"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-4" : "translate-x-1"}`}
                          />
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {deleteId === r.id ? (
                            <>
                              <button
                                onClick={() => handleDelete(r.id)}
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
                              <Link
                                href={`/recurring/new?id=${r.id}`}
                                className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => setDeleteId(r.id)}
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
    </div>
  );
}
