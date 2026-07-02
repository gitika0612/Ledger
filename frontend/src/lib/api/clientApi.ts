import api from "@/lib/api/api";

export interface ClientAPI {
  _id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertClientData {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
}

export interface ParsedClientDetails {
  email?: string;
  phone?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface ParseClientDetailsResult {
  success: boolean;
  parsed: ParsedClientDetails;
  client: ClientAPI | null;
  saved: boolean;
}

export async function getUserClients(): Promise<ClientAPI[]> {
  const response = await api.get("/clients");
  return response.data.clients;
}

export async function getClientByName(
  name: string
): Promise<ClientAPI | null> {
  const response = await api.get("/clients/search", {
    params: { name },
  });
  return response.data.client;
}

export async function upsertClient(
  data: UpsertClientData
): Promise<ClientAPI> {
  const response = await api.post("/clients", data);
  return response.data.client;
}

export async function deleteClient(clientId: string): Promise<void> {
  await api.delete(`/clients/${clientId}`);
}

// ── Parse client details from natural language text ──
export async function parseClientDetailsFromText(
  text: string,
  clientName: string
): Promise<ParseClientDetailsResult> {
  const response = await api.post("/clients/parse-details", {
    text,
    clientName,
  });
  return response.data;
}

export async function updateClientByName(
  name: string,
  data: Partial<Omit<UpsertClientData, "name">>
): Promise<ClientAPI | null> {
  const response = await api.patch(
    `/clients/by-name/${encodeURIComponent(name)}`,
    data
  );
  return response.data.client;
}
