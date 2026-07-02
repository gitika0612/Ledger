/// <reference types="node" />
import { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { User } from "../models/User";

export async function syncUser(req: Request, res: Response): Promise<void> {
  const { userId: clerkId } = getAuth(req);
  const { email, firstName, lastName, imageUrl } = req.body;

  if (!clerkId || !email) {
    res.status(400).json({ error: "clerkId and email are required" });
    return;
  }

  try {
    const user = await User.findOneAndUpdate(
      { clerkId },
      {
        $set: {
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          imageUrl: imageUrl || "",
        },
        $setOnInsert: {
          isOnboarded: false,
        },
      },
      { upsert: true, new: true }
    );
    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("❌ Sync user error:", err);
    res.status(500).json({ error: "Failed to sync user" });
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const { userId: clerkId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId, isActive: true });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json({ user });
  } catch (err) {
    console.error("❌ Get user error:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getProfile(req: Request, res: Response): Promise<void> {
  const { userId: clerkId } = getAuth(req);

  try {
    const user = await User.findOne({ clerkId }).lean();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.status(200).json({ success: true, profile: user });
  } catch (err) {
    console.error("❌ Get profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function updateProfile(
  req: Request,
  res: Response
): Promise<void> {
  const { userId: clerkId } = getAuth(req);

  const {
    businessName,
    gstin,
    pan,
    address,
    city,
    state,
    pincode,
    phone,
    bankName,
    accountNumber,
    ifscCode,
    upiId,
  } = req.body;

  try {
    const updateData: any = {
      isOnboarded: true,
    };

    if (businessName !== undefined) updateData.businessName = businessName;
    if (gstin !== undefined) updateData.gstin = gstin;
    if (pan !== undefined) updateData.pan = pan;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (phone !== undefined) updateData.phone = phone;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (ifscCode !== undefined) updateData.ifscCode = ifscCode;
    if (upiId !== undefined) updateData.upiId = upiId;

    const user = await User.findOneAndUpdate(
      { clerkId },
      { $set: updateData },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    console.log(`✅ Profile updated for ${clerkId}`);
    res.status(200).json({ success: true, profile: user });
  } catch (err) {
    console.error("❌ Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}
