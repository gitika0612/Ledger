import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { useCallback } from "react";
import api from "@/lib/api/api";

export interface UserProfile {
  _id?: string;
  clerkId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  plan?: "free" | "pro" | "business";
  isOnboarded?: boolean;
  // Business profile
  businessName: string;
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  // Bank details
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  upiId: string;
}

export function useAuth() {
  const { signOut, isSignedIn, isLoaded } = useClerkAuth();
  const { user } = useUser();

  const syncUser = useCallback(async () => {
    if (!user) return;
    try {
      await api.post("/users/sync", {
        email: user.primaryEmailAddress?.emailAddress || "",
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        imageUrl: user.imageUrl || "",
      });
    } catch (err) {
      console.error("User sync failed:", err);
    }
  }, [user]);

  const getUserProfile = useCallback(async (): Promise<UserProfile | null> => {
    if (!user) return null;
    try {
      const response = await api.get("/users/profile");
      return response.data.profile;
    } catch (err) {
      console.error("Get profile failed:", err);
      return null;
    }
  }, [user]);

  const updateUserProfile = useCallback(
    async (profile: Partial<UserProfile>): Promise<UserProfile | null> => {
      if (!user) return null;
      try {
        const response = await api.put("/users/profile", profile);
        return response.data.profile;
      } catch (err) {
        console.error("Update profile failed:", err);
        return null;
      }
    },
    [user]
  );

  return {
    isSignedIn,
    isLoaded,
    user,
    signOut,
    syncUser,
    getUserProfile,
    updateUserProfile,
  };
}
