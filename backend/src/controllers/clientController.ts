import { Request, Response } from "express";
import { Client } from "../models/Client";

// ── Get all clients for a user ──
export async function getUserClients(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.headers["x-clerk-id"] as string;

  if (!userId) {
    res.status(400).json({ error: "Missing user ID" });
    return;
  }

  try {
    const clients = await Client.find({ userId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, clients });
  } catch (err) {
    console.error("❌ Get clients error:", err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
}

// ── Get single client ──
export async function getClientById(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;

  try {
    const client = await Client.findById(id).lean();
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.status(200).json({ success: true, client });
  } catch (err) {
    console.error("❌ Get client error:", err);
    res.status(500).json({ error: "Failed to fetch client" });
  }
}

// ── Create or update client (upsert by email) ──
export async function upsertClient(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-clerk-id"] as string;

  if (!userId) {
    res.status(400).json({ error: "Missing user ID" });
    return;
  }

  const { name, email, phone, address, city, state, pincode, gstin } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: "Name and email are required" });
    return;
  }

  try {
    const client = await Client.findOneAndUpdate(
      { userId, email: email.toLowerCase().trim() },
      {
        name,
        email: email.toLowerCase().trim(),
        phone: phone || "",
        address: address || "",
        city: city || "",
        state: state || "",
        pincode: pincode || "",
        gstin: gstin || "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`✅ Client upserted: ${client.name} (${client.email})`);
    res.status(200).json({ success: true, client });
  } catch (err) {
    console.error("❌ Upsert client error:", err);
    res.status(500).json({ error: "Failed to save client" });
  }
}

// ── Get client by name (for autofill) ──
export async function getClientByName(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.headers["x-clerk-id"] as string;
  const { name } = req.query;

  if (!userId) {
    res.status(400).json({ error: "Missing user ID" });
    return;
  }

  try {
    const client = await Client.findOne({
      userId,
      name: { $regex: new RegExp(`^${name}$`, "i") },
    }).lean();

    res.status(200).json({ success: true, client: client || null });
  } catch (err) {
    console.error("❌ Get client by name error:", err);
    res.status(500).json({ error: "Failed to fetch client" });
  }
}

// ── Delete client ──
export async function deleteClient(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  try {
    const client = await Client.findByIdAndDelete(id);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    console.log(`✅ Client deleted: ${client.name}`);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Delete client error:", err);
    res.status(500).json({ error: "Failed to delete client" });
  }
}

// ── Parse client details from natural language ──
export async function parseClientDetails(
  req: Request,
  res: Response
): Promise<void> {
  const userId = req.headers["x-clerk-id"] as string;
  const { text, clientName } = req.body;

  if (!userId || !text || !clientName) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // All Indian states/UTs in lowercase for matching
  const INDIAN_STATES = new Set([
    "andhra pradesh",
    "arunachal pradesh",
    "assam",
    "bihar",
    "chhattisgarh",
    "goa",
    "gujarat",
    "haryana",
    "himachal pradesh",
    "jharkhand",
    "karnataka",
    "kerala",
    "madhya pradesh",
    "maharashtra",
    "manipur",
    "meghalaya",
    "mizoram",
    "nagaland",
    "odisha",
    "punjab",
    "rajasthan",
    "sikkim",
    "tamil nadu",
    "telangana",
    "tripura",
    "uttar pradesh",
    "uttarakhand",
    "west bengal",
    "delhi",
    "new delhi",
    "jammu and kashmir",
    "ladakh",
    "chandigarh",
    "puducherry",
    "pondicherry",
    "andaman and nicobar",
    "dadra and nagar haveli",
    "daman and diu",
    "lakshadweep",
  ]);

  // Words that indicate this part is address, not city
  const ADDRESS_KEYWORDS =
    /sector|block|floor|phase|plot|near|opp|behind|road|street|nagar|vihar|colony|enclave|apartments?|tower|building|house|flat|shop|office|ward|cross|layout|extension|marg|chowk|bazaar|market/i;

  try {
    // ── Step 1: Extract structured fields via regex ──
    const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    const phoneMatch = text.match(/(?<!\d)[6-9]\d{9}(?!\d)/);
    const gstinMatch = text.match(
      /[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i
    );
    const pincodeMatch = text.match(/(?<!\d)[1-9][0-9]{5}(?!\d)/);

    // ── Step 2: Try labeled format first ──
    const labeledCity = text
      .match(/[Cc]ity[\s]*[-:]\s*([A-Za-z\s]+?)(?:,|$|\n)/)?.[1]
      ?.trim();
    const labeledState = text
      .match(/[Ss]tate[\s]*[-:]\s*([A-Za-z\s]+?)(?:,|$|\n)/)?.[1]
      ?.trim();
    const labeledAddress = text
      .match(/[Aa]ddress[\s]*[-:]\s*(.+?)(?:\n|$)/)?.[1]
      ?.trim();

    let city: string | undefined = labeledCity;
    let state: string | undefined = labeledState;
    let address: string | undefined = labeledAddress;

    // ── Step 3: Plain comma-separated fallback ──
    if (!city || !state) {
      const stripped = text
        .replace(/[\w.+-]+@[\w.-]+\.\w+/, "")
        .replace(/[6-9]\d{9}/, "")
        .replace(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/i, "")
        .replace(/(?<!\d)[1-9][0-9]{5}(?!\d)/, "")
        .replace(/[Cc]ity[\s]*[-:]\s*/g, "")
        .replace(/[Ss]tate[\s]*[-:]\s*/g, "")
        .replace(/[Aa]ddress[\s]*[-:]\s*/g, "")
        .replace(/,\s*,/g, ",")
        .replace(/^\s*,|,\s*$/g, "")
        .trim();

      const parts = stripped
        .split(",")
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 1);

      console.log("📍 Address parts:", parts);

      if (parts.length === 0) {
        // nothing to parse
      } else if (parts.length === 1) {
        const p = parts[0].toLowerCase();
        if (INDIAN_STATES.has(p)) {
          state = state || parts[0];
        } else {
          city = city || parts[0];
        }
      } else {
        // Find the last part that is a recognized Indian state
        let stateIndex = -1;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (INDIAN_STATES.has(parts[i].toLowerCase())) {
            stateIndex = i;
            break;
          }
        }

        if (stateIndex !== -1) {
          // Found a real state
          state = state || parts[stateIndex];

          // Everything before the state: find city = last non-address part before state
          const beforeState = parts.slice(0, stateIndex);

          if (beforeState.length === 0) {
            // Only state provided
          } else if (beforeState.length === 1) {
            // Could be city or address
            if (ADDRESS_KEYWORDS.test(beforeState[0])) {
              address = address || beforeState[0];
            } else {
              city = city || beforeState[0];
            }
          } else {
            // Last part before state = city (if it doesn't look like address)
            const potentialCity = beforeState[beforeState.length - 1];
            if (!ADDRESS_KEYWORDS.test(potentialCity)) {
              city = city || potentialCity;
              address = address || beforeState.slice(0, -1).join(", ");
            } else {
              // Last part looks like address too — all of beforeState is address
              address = address || beforeState.join(", ");
            }
          }
        } else {
          // No recognized state — treat last non-address part as city, rest as address
          const lastPart = parts[parts.length - 1];
          if (parts.length === 1) {
            if (ADDRESS_KEYWORDS.test(parts[0])) {
              address = address || parts[0];
            } else {
              city = city || parts[0];
            }
          } else if (!ADDRESS_KEYWORDS.test(lastPart)) {
            // Last part looks like a city name
            city = city || lastPart;
            address = address || parts.slice(0, -1).join(", ");
          } else {
            // Everything looks like address lines
            address = address || parts.join(", ");
          }
        }
      }
    }

    // ── Step 4: Clean state — strip digits and extra whitespace ──
    if (state) {
      state = state.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
      if (!state) state = undefined;
    }

    // ── Step 5: Try to infer state from text if still missing ──
    if (!state) {
      const lowerText = text.toLowerCase();

      const matchedState = Array.from(INDIAN_STATES).find((s) =>
        lowerText.includes(s)
      );

      if (matchedState) {
        state = matchedState
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }
    }

    const parsed = {
      email: emailMatch?.[0] || undefined,
      phone: phoneMatch?.[0] || undefined,
      gstin: gstinMatch?.[0]?.toUpperCase() || undefined,
      pincode: pincodeMatch?.[0] || undefined,
      city: city || undefined,
      state: state || undefined,
      address: address || undefined,
    };

    console.log("📧 Parsed client details:", parsed);

    // ── Step 6: Save if email present ──
    if (parsed.email) {
      const client = await Client.findOneAndUpdate(
        { userId, email: parsed.email.toLowerCase().trim() },
        {
          name: clientName,
          email: parsed.email.toLowerCase().trim(),
          phone: parsed.phone || "",
          address: parsed.address || "",
          city: parsed.city || "",
          state: parsed.state || "",
          pincode: parsed.pincode || "",
          gstin: parsed.gstin || "",
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(
        `✅ Client saved: ${client.name} | address: ${client.address} | city: ${client.city} | state: ${client.state} | pincode: ${client.pincode}`
      );
      res.status(200).json({ success: true, parsed, client, saved: true });
    } else {
      console.log(`⚠️ No email found — client not saved`);
      res
        .status(200)
        .json({ success: true, parsed, client: null, saved: false });
    }
  } catch (err) {
    console.error("❌ Parse client details error:", err);
    res.status(500).json({ error: "Failed to parse client details" });
  }
}
