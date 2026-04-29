import type { DocumentType, InvoiceItem } from "./invoice";

export type RecurringFrequency = "weekly" | "monthly" | "yearly";

/** Shape stored in PocketBase `recurring_invoices` collection */
export type RecurringRecord = {
  id?: string;
  user: string;
  // Template fields (mirrors InvoiceRecord, minus invoice_number / date / due_date / status)
  document_type: DocumentType;
  from_details: string;
  bill_to: string;
  ship_to: string;
  notes: string;
  terms: string;
  tax: number;
  discount: number;
  shipping: number;
  amount_paid: number;
  items: InvoiceItem[];
  client?: string;
  // Recurring-specific
  frequency: RecurringFrequency;
  next_run_date: string; // YYYY-MM-DD
  active: boolean;
  auto_send: boolean;
  expand?: {
    client?: {
      id: string;
      client_name: string;
      email: string;
      details: string;
    };
  };
};
