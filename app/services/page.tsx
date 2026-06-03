"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { ServiceRecord } from "@/types/service";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(value);
}

type ServiceForm = {
  name: string;
  description: string;
  priceExcl: string;
};

const EMPTY_FORM: ServiceForm = {
  name: "",
  description: "",
  priceExcl: "",
};

export default function ServicesPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [services, setServices] = useState<RecordModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchServices = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const records = await pb.collection("services").getFullList({
        sort: "name",
      });
      setServices(records);
    } catch (err) {
      console.error("Failed to fetch services", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchServices();
  }, [user, fetchServices]);

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setSaveError("");
    setModalOpen(true);
  }

  function openEdit(rec: RecordModel) {
    setEditId(rec.id);
    const excl = rec.default_price ?? 0;
    setForm({
      name: rec.name ?? "",
      description: rec.description ?? "",
      priceExcl: String(excl),
    });
    setSaveError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!user) return;
    if (!form.name.trim()) {
      setSaveError("Service name is required.");
      return;
    }
    const parsedPrice = parseFloat(form.priceExcl);
    if (form.priceExcl !== "" && (isNaN(parsedPrice) || parsedPrice < 0)) {
      setSaveError("Price cannot be negative.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const data = {
        user: user.id,
        name: form.name.trim(),
        description: form.description?.trim() ?? "",
        default_price: isNaN(parsedPrice) ? 0 : parsedPrice,
      };
      if (editId) {
        const updated = await pb.collection("services").update(editId, data);
        setServices((prev) => prev.map((r) => (r.id === editId ? updated : r)));
      } else {
        const created = await pb.collection("services").create(data);
        setServices((prev) =>
          [...prev, created].sort((a, b) =>
            (a.name as string).localeCompare(b.name as string),
          ),
        );
      }
      setModalOpen(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save service.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await pb.collection("services").delete(id);
      setServices((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete service", err);
    } finally {
      setDeleteId(null);
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
                  Services
                </span>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">{user.email}</span>
              <button
                onClick={openAdd}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
              >
                <span className="text-base leading-none">+</span> New Service
              </button>
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
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">
            Service Catalog
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Define services and their default prices. Assign these to clients
            when setting up their billing.
          </p>
        </div>

        {isLoading ? (
          <div className="text-sm text-slate-400">Loading services…</div>
        ) : services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <p className="text-slate-500 text-sm mb-3">
              No services yet. Add your first service to get started.
            </p>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <span className="text-base leading-none">+</span> New Service
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left font-medium text-slate-600">
                    Service
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">
                    Default Price
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => (
                  <tr
                    key={svc.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {svc.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {svc.description || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {formatCurrency(svc.default_price)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(svc)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteId(svc.id)}
                          className="text-xs text-rose-500 hover:text-rose-700 font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-5">
              {editId ? "Edit Service" : "New Service"}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Service Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. Web Hosting"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="Optional description"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Price (ZAR)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.priceExcl}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, priceExcl: e.target.value }));
                  }}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {saveError && (
                <p className="text-xs text-rose-600">{saveError}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Delete service?
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              This cannot be undone. Any clients currently assigned this service
              will keep their assignment but it will reference a deleted
              service.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
