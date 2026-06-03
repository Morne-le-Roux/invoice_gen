export type ChargeType = "monthly" | "once_off";

/** Shape stored in PocketBase `services` collection */
export type ServiceRecord = {
  id?: string;
  user: string;
  name: string;
  description?: string;
  default_price: number;
};

/** Shape stored in PocketBase `client_services` collection */
export type ClientServiceRecord = {
  id?: string;
  user: string;
  client: string;
  service: string;
  price: number;
  charge_type: ChargeType;
  active: boolean;
  notes?: string;
  end_date?: string;
  expand?: {
    service?: ServiceRecord;
  };
};
