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

export async function getUserClients(userId: string): Promise<ClientAPI[]> {
  const response = await api.get("/clients", {
    headers: { "x-clerk-id": userId },
  });
  return response.data.clients;
}

export async function getClientByName(
  userId: string,
  name: string
): Promise<ClientAPI | null> {
  const response = await api.get("/clients/search", {
    headers: { "x-clerk-id": userId },
    params: { name },
  });
  return response.data.client;
}

export async function upsertClient(
  userId: string,
  data: UpsertClientData
): Promise<ClientAPI> {
  const response = await api.post("/clients", data, {
    headers: { "x-clerk-id": userId },
  });
  return response.data.client;
}

export async function deleteClient(
  userId: string,
  clientId: string
): Promise<void> {
  await api.delete(`/clients/${clientId}`, {
    headers: { "x-clerk-id": userId },
  });
}

// ── Parse client details from natural language text ──
export async function parseClientDetailsFromText(
  userId: string,
  text: string,
  clientName: string
): Promise<ParseClientDetailsResult> {
  const response = await api.post(
    "/clients/parse-details",
    { text, clientName },
    { headers: { "x-clerk-id": userId } }
  );
  return response.data;
}

export async function updateClientByName(
  userId: string,
  name: string,
  data: Partial<Omit<UpsertClientData, "name">>
): Promise<ClientAPI | null> {
  const response = await api.patch(
    `/clients/by-name/${encodeURIComponent(name)}`,
    data,
    { headers: { "x-clerk-id": userId } }
  );
  return response.data.client;
}
