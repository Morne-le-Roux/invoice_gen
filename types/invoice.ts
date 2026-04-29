export type DocumentType = "invoice" | "quote" | "proforma";

export type InvoiceItem = {
  id: number;
  description: string;
  quantity: number;
  rate: number;
};

export type InvoiceStatus = "draft" | "sent" | "paid";

/** Shape stored in PocketBase `invoices` collection */
export type InvoiceRecord = {
  id?: string;
  user: string;
  document_type: DocumentType;
  invoice_number: string;
  from_details: string;
  bill_to: string;
  ship_to: string;
  invoice_date: string;
  due_date: string;
  notes: string;
  terms: string;
  tax: number;
  discount: number;
  shipping: number;
  amount_paid: number;
  items: InvoiceItem[];
  logo_data_url: string;
  logo_width: number;
  status: InvoiceStatus;
  client_email?: string;
  client?: string;
  expand?: {
    client?: {
      id: string;
      client_name: string;
      email: string;
      details: string;
    };
  };
};
