"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import type { ClientRecord } from "@/types/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

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
                <span className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10">
                  Clients
                </span>
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
                onClick={openAdd}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
              >
                <span className="text-base leading-none">+</span> New Client
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
            {!isLoading && clients.length > 0 && (
              <p className="text-sm text-slate-500 mt-1">
                {clients.length} client{clients.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-slate-400">Loading clients…</p>
          </div>
        ) : clients.length === 0 ? (
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
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <p className="text-slate-500 text-sm mb-5">No clients yet.</p>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              + Add your first client
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((r) => {
              const name = (r.client_name as string) ?? "";
              const initials = getInitials(name);
              const avatarBg = avatarColor(name);
              return (
                <div
                  key={r.id}
                  className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col gap-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full ${avatarBg} flex items-center justify-center text-white text-sm font-bold shrink-0`}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate">
                        {name || <span className="text-slate-300">—</span>}
                      </p>
                      {r.email ? (
                        <p className="text-sm text-slate-500 truncate mt-0.5">
                          {r.email}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-300 mt-0.5">
                          No email
                        </p>
                      )}
                    </div>
                  </div>
                  {r.details && (
                    <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-3 leading-relaxed border-t border-slate-100 pt-3">
                      {r.details}
                    </p>
                  )}
                  <div className="flex items-center gap-2 border-t border-slate-100 pt-3 mt-auto">
                    <button
                      onClick={() => openEdit(r)}
                      className="flex-1 inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    >
                      Edit
                    </button>
                    {deleteId === r.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="flex-1 inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          className="flex-1 inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteId(r.id)}
                        className="inline-flex items-center justify-center rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5">
            <h2 className="text-base font-semibold text-slate-900 mb-5">
              {editId ? "Edit Client" : "New Client"}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.client_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, client_name: e.target.value }))
                  }
                  placeholder="Acme Corp"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="billing@acmecorp.com"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Bill To Details
                </label>
                <textarea
                  value={form.details}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, details: e.target.value }))
                  }
                  placeholder={"Acme Corp\n123 Main Street\nCity, Country"}
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition resize-none"
                />
                <p className="mt-1.5 text-xs text-slate-400">
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
                className="rounded-xl px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-60"
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
