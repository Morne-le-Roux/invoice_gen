"use client";

import { useAuth } from "@/context/AuthContext";
import pb from "@/lib/pocketbase";
import { generateClientInvoice } from "@/lib/generate-client-invoice";
import type { ClientRecord } from "@/types/client";
import type {
  ClientServiceRecord,
  ChargeType,
  ServiceRecord,
} from "@/types/service";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import type { RecordModel } from "pocketbase";
import { useCallback, useEffect, useState } from "react";

const CHARGE_LABELS: Record<ChargeType, string> = {
  monthly: "Monthly",
  once_off: "Once-off",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(value);
}

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

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

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

type AddServiceForm = {
  service: string;
  price: string;
  charge_type: ChargeType;
  notes: string;
};

const EMPTY_ADD: AddServiceForm = {
  service: "",
  price: "",
  charge_type: "monthly",
  notes: "",
};

export default function ClientDetailPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<RecordModel | null>(null);
  const [clientServices, setClientServices] = useState<RecordModel[]>([]);
  const [catalog, setCatalog] = useState<ServiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit client modal
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState({
    client_name: "",
    email: "",
    details: "",
    billing_day: "",
  });
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState("");

  // Add service modal
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddServiceForm>({ ...EMPTY_ADD });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit service assignment modal
  const [editServiceId, setEditServiceId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AddServiceForm>({ ...EMPTY_ADD });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Generate invoice
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  // Delete client service
  const [deleteServiceId, setDeleteServiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchData = useCallback(async () => {
    if (!user || !clientId) return;
    setIsLoading(true);
    try {
      const [clientRec, services, catalogRecs] = await Promise.all([
        pb.collection("clients").getOne(clientId),
        pb.collection("client_services").getFullList({
          filter: `client = "${clientId}"`,
          expand: "service",
          sort: "created",
        }),
        pb.collection("services").getFullList({ sort: "name" }),
      ]);
      setClient(clientRec);
      setClientServices(services);
      setCatalog(catalogRecs as unknown as ServiceRecord[]);
    } catch (err) {
      console.error("Failed to load client data", err);
    } finally {
      setIsLoading(false);
    }
  }, [user, clientId]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  function openEditClient() {
    if (!client) return;
    setClientForm({
      client_name: client.client_name ?? "",
      email: client.email ?? "",
      details: client.details ?? "",
      billing_day: client.billing_day ? String(client.billing_day) : "",
    });
    setClientError("");
    setEditClientOpen(true);
  }

  async function handleSaveClient() {
    if (!client) return;
    if (!clientForm.client_name.trim()) {
      setClientError("Client name is required.");
      return;
    }
    setClientSaving(true);
    setClientError("");
    try {
      const updated = await pb.collection("clients").update(client.id, {
        client_name: clientForm.client_name.trim(),
        email: clientForm.email.trim(),
        details: clientForm.details,
        billing_day:
          clientForm.billing_day !== ""
            ? parseInt(clientForm.billing_day) || null
            : null,
      });
      setClient(updated);
      setEditClientOpen(false);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setClientSaving(false);
    }
  }

  function openAddService() {
    setAddForm({ ...EMPTY_ADD });
    setAddError("");
    setAddServiceOpen(true);
  }

  function handleServiceSelect(serviceId: string) {
    const svc = catalog.find((s) => s.id === serviceId);
    setAddForm((f) => ({
      ...f,
      service: serviceId,
      price: svc ? String(svc.default_price) : f.price,
    }));
  }

  async function handleAddService() {
    if (!user || !client) return;
    if (!addForm.service) {
      setAddError("Please select a service.");
      return;
    }
    const price = parseFloat(addForm.price);
    if (isNaN(price) || price < 0) {
      setAddError("Please enter a valid price.");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      const created = await pb.collection("client_services").create({
        user: user.id,
        client: clientId,
        service: addForm.service,
        price,
        charge_type: addForm.charge_type,
        active: true,
        notes: addForm.notes.trim(),
      });
      // Refetch to get expand
      const withExpand = await pb
        .collection("client_services")
        .getOne(created.id, { expand: "service" });
      setClientServices((prev) => [...prev, withExpand]);
      setAddServiceOpen(false);
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "Failed to add service.",
      );
    } finally {
      setAddSaving(false);
    }
  }

  function openEditService(rec: RecordModel) {
    const cs = rec as unknown as ClientServiceRecord & { id: string };
    setEditServiceId(cs.id);
    setEditForm({
      service: cs.service,
      price: String(cs.price),
      charge_type: cs.charge_type,
      notes: cs.notes ?? "",
    });
    setEditError("");
  }

  async function handleSaveEditService() {
    if (!editServiceId) return;
    const price = parseFloat(editForm.price);
    if (isNaN(price) || price < 0) {
      setEditError("Please enter a valid price.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    try {
      await pb.collection("client_services").update(editServiceId, {
        price,
        charge_type: editForm.charge_type,
        notes: editForm.notes.trim(),
      });
      const withExpand = await pb
        .collection("client_services")
        .getOne(editServiceId, { expand: "service" });
      setClientServices((prev) =>
        prev.map((r) => (r.id === editServiceId ? withExpand : r)),
      );
      setEditServiceId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleToggleActive(rec: RecordModel) {
    try {
      const updated = await pb
        .collection("client_services")
        .update(rec.id, { active: !rec.active });
      setClientServices((prev) =>
        prev.map((r) =>
          r.id === rec.id ? { ...r, active: updated.active } : r,
        ),
      );
    } catch (err) {
      console.error("Failed to toggle service", err);
    }
  }

  async function handleDeleteService(id: string) {
    try {
      await pb.collection("client_services").delete(id);
      setClientServices((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete service", err);
    } finally {
      setDeleteServiceId(null);
    }
  }

  async function handleGenerateInvoice() {
    if (!user || !client) return;
    setGenerating(true);
    setGenerateError("");
    try {
      await generateClientInvoice(pb, user.id, clientId);
      // Refresh services (once_off may have been deactivated)
      await fetchData();
      router.push("/dashboard");
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Unexpected error.",
      );
    } finally {
      setGenerating(false);
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Client not found.</div>
      </div>
    );
  }

  const activeServices = clientServices.filter((cs) => cs.active);
  const subtotal = activeServices.reduce(
    (sum, cs) => sum + (cs.price as number),
    0,
  );
  const total = subtotal;

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
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10"
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

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link
            href="/clients"
            className="hover:text-slate-800 transition-colors"
          >
            Clients
          </Link>
          <span>/</span>
          <span className="text-slate-800 font-medium">
            {client.client_name}
          </span>
        </div>

        {/* Client Info Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white font-bold text-sm ${avatarColor(client.client_name)}`}
              >
                {getInitials(client.client_name)}
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  {client.client_name}
                </h1>
                <div className="mt-1 space-y-0.5 text-sm text-slate-500">
                  {client.email && <p>{client.email}</p>}
                  {client.details && (
                    <p className="whitespace-pre-line">{client.details}</p>
                  )}
                  {client.billing_day && (
                    <p className="text-slate-400">
                      Billing day: {client.billing_day} of each month
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openEditClient}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleGenerateInvoice}
                disabled={generating || activeServices.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-1.5 text-sm font-medium text-white transition-colors"
              >
                {generating ? "Generating…" : "Generate Invoice"}
              </button>
            </div>
          </div>
          {generateError && (
            <p className="mt-3 text-sm text-rose-600">{generateError}</p>
          )}
          {activeServices.length === 0 && (
            <p className="mt-3 text-xs text-amber-600">
              No active services — add at least one service before generating an
              invoice.
            </p>
          )}
        </div>

        {/* Invoice Preview */}
        {activeServices.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">
              Next Invoice Estimate
            </p>
            <div className="space-y-1 text-sm">
              {activeServices.map((cs) => (
                <div
                  key={cs.id}
                  className="flex justify-between text-slate-700"
                >
                  <span>
                    {(cs.expand as Record<string, RecordModel>)?.service
                      ?.name ?? "Service"}
                    {cs.notes ? ` – ${cs.notes}` : ""}
                    <span className="ml-2 text-xs text-slate-400">
                      ({CHARGE_LABELS[cs.charge_type as ChargeType]})
                    </span>
                  </span>
                  <span className="font-mono">
                    {formatCurrency(cs.price as number)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-slate-500 pt-2 border-t border-slate-100">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Services */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-900">Services</h2>
            <button
              onClick={openAddService}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors"
            >
              <span className="text-base leading-none">+</span> Add Service
            </button>
          </div>

          {clientServices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <p className="text-sm text-slate-500">
                No services assigned yet.
              </p>
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
                      Notes
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">
                      Type
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">
                      Price
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-slate-600">
                      Active
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clientServices.map((cs) => {
                    const svcName =
                      (cs.expand as Record<string, RecordModel>)?.service
                        ?.name ?? "—";
                    return (
                      <tr
                        key={cs.id}
                        className={`border-b border-slate-100 last:border-0 ${!cs.active ? "opacity-50" : ""}`}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {svcName}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {cs.notes || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              cs.charge_type === "monthly"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {CHARGE_LABELS[cs.charge_type as ChargeType]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-800">
                          {formatCurrency(cs.price as number)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(cs)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${cs.active ? "bg-indigo-600" : "bg-slate-200"}`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${cs.active ? "translate-x-4" : "translate-x-1"}`}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditService(cs)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteServiceId(cs.id)}
                              className="text-xs text-rose-500 hover:text-rose-700 font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Edit Client Modal */}
      {editClientOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-5">
              Edit Client
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  value={clientForm.client_name}
                  onChange={(e) =>
                    setClientForm((f) => ({
                      ...f,
                      client_name: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Details
                </label>
                <textarea
                  rows={3}
                  value={clientForm.details}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, details: e.target.value }))
                  }
                  placeholder="Address, contact info…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Billing Day (1–28)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={clientForm.billing_day}
                  onChange={(e) =>
                    setClientForm((f) => ({
                      ...f,
                      billing_day: e.target.value,
                    }))
                  }
                  placeholder="e.g. 1"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {clientError && (
                <p className="text-xs text-rose-600">{clientError}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setEditClientOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveClient}
                disabled={clientSaving}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                {clientSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Service Modal */}
      {addServiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-5">
              Add Service
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Service *
                </label>
                <select
                  value={addForm.service}
                  onChange={(e) => handleServiceSelect(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select a service…</option>
                  {catalog.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name} ({formatCurrency(svc.default_price)})
                    </option>
                  ))}
                </select>
                {catalog.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    No services in catalog.{" "}
                    <Link href="/services" className="underline">
                      Add services
                    </Link>{" "}
                    first.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Price (ZAR) *
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={addForm.price}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, price: e.target.value }))
                  }
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Charge Type
                </label>
                <select
                  value={addForm.charge_type}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      charge_type: e.target.value as ChargeType,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="monthly">Monthly (recurring)</option>
                  <option value="once_off">Once-off</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={addForm.notes}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Optional line item note"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {addError && <p className="text-xs text-rose-600">{addError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setAddServiceOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddService}
                disabled={addSaving}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                {addSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Service Assignment Modal */}
      {editServiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900 mb-5">
              Edit Service Assignment
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Price (ZAR) *
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editForm.price}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, price: e.target.value }))
                  }
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Charge Type
                </label>
                <select
                  value={editForm.charge_type}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      charge_type: e.target.value as ChargeType,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="monthly">Monthly (recurring)</option>
                  <option value="once_off">Once-off</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Optional line item note"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {editError && (
                <p className="text-xs text-rose-600">{editError}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setEditServiceId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditService}
                disabled={editSaving}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Service Confirmation */}
      {deleteServiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Remove service?
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              This will remove the service from this client. It will not affect
              previously generated invoices.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteServiceId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteService(deleteServiceId)}
                className="rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
