import type { InvoiceRecord } from "@/types/invoice";
import type { ClientServiceRecord } from "@/types/service";
import { COMPANY_FROM_DETAILS } from "@/lib/company-details";
import PocketBase from "pocketbase";

function buildInvoiceNumber(clientName: string): string {
  const letters = clientName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(100 + Math.random() * 900));
  return `${letters}-${mm}${dd}-${rand}`;
}

export async function generateClientInvoice(
  pb: PocketBase,
  userId: string,
  clientId: string,
): Promise<InvoiceRecord & { id: string }> {
  // Fetch client
  const client = await pb.collection("clients").getOne(clientId);

  // Fetch active client_services for this client, expanding service
  const clientServices = await pb
    .collection("client_services")
    .getFullList<ClientServiceRecord>({
      filter: `client = "${clientId}" && active = true`,
      expand: "service",
    });

  if (clientServices.length === 0) {
    throw new Error("This client has no active services to invoice.");
  }

  const today = new Date().toISOString().split("T")[0];

  // Deactivate any services whose end_date has been reached
  const expiredServices = clientServices.filter(
    (cs) => cs.end_date && cs.end_date <= today,
  );
  await Promise.all(
    expiredServices.map((cs) =>
      pb.collection("client_services").update(cs.id!, { active: false }),
    ),
  );

  const billableServices = clientServices.filter(
    (cs) => !cs.end_date || cs.end_date > today,
  );

  if (billableServices.length === 0) {
    throw new Error(
      "All active services have expired. No services to invoice.",
    );
  }

  // Map to invoice line items
  const items = billableServices.map((cs, idx) => {
    const serviceName =
      cs.expand?.service?.name ?? cs.notes ?? `Service ${idx + 1}`;
    const description = [serviceName, cs.notes].filter(Boolean).join(" – ");
    return {
      id: idx + 1,
      description,
      quantity: 1,
      rate: cs.price,
    };
  });

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.rate,
    0,
  );

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toISOString().split("T")[0];

  const billTo = [client.client_name, client.details, client.email]
    .filter(Boolean)
    .join("\n");

  const invoiceData: Omit<InvoiceRecord, "id" | "expand"> = {
    user: userId,
    document_type: "invoice",
    invoice_number: buildInvoiceNumber(client.client_name),
    from_details: COMPANY_FROM_DETAILS,
    bill_to: billTo,
    ship_to: "",
    invoice_date: today,
    due_date: dueDateStr,
    notes: "",
    terms: "",
    tax: 0,
    discount: 0,
    shipping: 0,
    amount_paid: 0,
    items,
    logo_data_url: "",
    logo_width: 0,
    status: "draft",
    client: clientId,
    client_email: client.email,
  };

  const created = await pb
    .collection("invoices")
    .create<InvoiceRecord & { id: string }>(invoiceData);

  // Mark once_off services as inactive
  const onceOffs = billableServices.filter(
    (cs) => cs.charge_type === "once_off",
  );
  await Promise.all(
    onceOffs.map((cs) =>
      pb.collection("client_services").update(cs.id!, { active: false }),
    ),
  );

  return created;
}
