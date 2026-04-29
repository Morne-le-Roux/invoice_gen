"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

const EMPTY_FORM: Omit<ClientRecord, "id" | "user"> = {
  client_name: "",
  details: "",
  email: "",
};

export default function ClientsPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [clients, setClients] = useState<RecordModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchClients = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const records = await pb.collection("clients").getFullList({
        sort: "client_name",
      });
      setClients(records);
    } catch (err) {
      console.error("Failed to fetch clients", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchClients();
  }, [user, fetchClients]);

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setSaveError("");
    setModalOpen(true);
  }

  function openEdit(rec: RecordModel) {
    setEditId(rec.id);
    setForm({
      client_name: rec.client_name ?? "",
      details: rec.details ?? "",
      email: rec.email ?? "",
    });
    setSaveError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!user) return;
    if (!form.client_name.trim()) {
      setSaveError("Client name is required.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const data = {
        user: user.id,
        client_name: form.client_name.trim(),
        details: form.details,
        email: form.email.trim(),
      };
      if (editId) {
        const updated = await pb.collection("clients").update(editId, data);
        setClients((prev) => prev.map((r) => (r.id === editId ? updated : r)));
      } else {
        const created = await pb.collection("clients").create(data);
        setClients((prev) =>
          [...prev, created].sort((a, b) =>
            (a.client_name as string).localeCompare(b.client_name as string),
          ),
        );
      }
      setModalOpen(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save client.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await pb.collection("clients").delete(id);
      setClients((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete client", err);
    } finally {
      setDeleteId(null);
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
        <h1 className="text-lg font-semibold text-gray-900">Clients</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user.email}</span>
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Invoices
          </Link>
          <button
            onClick={openAdd}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            + New Client
          </button>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {isLoading ? (
          <p className="text-sm text-gray-400">Loading clients…</p>
        ) : clients.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm mb-4">No clients yet.</p>
            <button
              onClick={openAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors"
            >
              Add your first client
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400 uppercase tracking-wide">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Details</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {clients.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-gray-800">
                      {r.client_name}
                    </td>
                    <td className="px-5 py-3 text-gray-500">
                      {r.email || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs">
                      <span className="line-clamp-1 whitespace-pre-wrap">
                        {r.details || <span className="text-gray-300">—</span>}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Edit
                        </button>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Add / Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              {editId ? "Edit Client" : "New Client"}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.client_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, client_name: e.target.value }))
                  }
                  placeholder="Acme Corp"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="billing@acmecorp.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bill To Details
                </label>
                <textarea
                  value={form.details}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, details: e.target.value }))
                  }
                  placeholder={"Acme Corp\n123 Main Street\nCity, Country"}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  This text fills the Bill To field on invoices.
                </p>
              </div>
            </div>

            {saveError && (
              <p className="mt-3 text-sm text-red-600">{saveError}</p>
            )}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : editId ? "Save Changes" : "Add Client"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
