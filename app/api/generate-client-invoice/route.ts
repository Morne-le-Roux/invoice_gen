import { generateClientInvoice } from "@/lib/generate-client-invoice";
import { NextResponse } from "next/server";
import PocketBase from "pocketbase";

export async function POST(req: Request) {
  try {
    const { clientId } = await req.json();

    if (!clientId || typeof clientId !== "string") {
      return NextResponse.json(
        { error: "clientId is required." },
        { status: 400 },
      );
    }

    const pbUrl =
      process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;
    const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
    const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;

    if (!pbUrl || !adminEmail || !adminPassword) {
      return NextResponse.json(
        { error: "Server not configured." },
        { status: 500 },
      );
    }

    const pb = new PocketBase(pbUrl);
    await pb.admins.authWithPassword(adminEmail, adminPassword);

    // Fetch client to get owner user id
    const client = await pb.collection("clients").getOne(clientId);
    const invoice = await generateClientInvoice(pb, client.user, clientId);

    return NextResponse.json({ invoiceId: invoice.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
