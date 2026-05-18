import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Landmark,
  Save,
  CheckCircle2,
  Loader2,
  FileText,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { useAuth, UserProfile } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  INDIAN_STATES,
  profileSchema,
  parseProfileIssues,
  fieldClass,
} from "@/lib/profileValidation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

const emptyProfile: UserProfile = {
  businessName: "",
  gstin: "",
  pan: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  upiId: "",
};

const normalizeProfile = (data: UserProfile): UserProfile => ({
  ...data,
  businessName: data.businessName.trim(),
  address: data.address.trim(),
  city: data.city.trim(),
  state: data.state.trim(),
  pincode: data.pincode.trim(),
  phone: data.phone?.trim() || "",
  gstin: data.gstin?.trim() || "",
  pan: data.pan?.trim() || "",
  bankName: data.bankName?.trim() || "",
  accountNumber: data.accountNumber?.trim() || "",
  ifscCode: data.ifscCode?.trim() || "",
  upiId: data.upiId?.trim() || "",
});

type SaveState = "idle" | "saving" | "saved";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, getUserProfile, updateUserProfile } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openStateDropdown, setOpenStateDropdown] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const data = await getUserProfile();
      if (data) {
        setProfile({
          businessName: data.businessName || "",
          gstin: data.gstin || "",
          pan: data.pan || "",
          address: data.address || "",
          city: data.city || "",
          state: data.state || "",
          pincode: data.pincode || "",
          phone: data.phone || "",
          bankName: data.bankName || "",
          accountNumber: data.accountNumber || "",
          ifscCode: data.ifscCode || "",
          upiId: data.upiId || "",
        });
      }
      setLoading(false);
    })();
  }, [user, getUserProfile]);

  const normalizedProfile = useMemo(() => normalizeProfile(profile), [profile]);

  const validationResult = useMemo(
    () => profileSchema.safeParse(normalizedProfile),
    [normalizedProfile]
  );

  const completionPercent = useMemo(() => {
    const requiredFields = [
      normalizedProfile.businessName,
      normalizedProfile.address,
      normalizedProfile.city,
      normalizedProfile.state,
      normalizedProfile.pincode,
    ];
    return Math.round(
      (requiredFields.filter(Boolean).length / requiredFields.length) * 100
    );
  }, [normalizedProfile]);

  const handleChange = (field: keyof UserProfile, value: string) => {
    const updated = { ...profile, [field]: value };
    setProfile(updated);

    if (saveState === "saved") {
      setSaveState("idle");
    }

    const result = profileSchema.safeParse(normalizeProfile(updated));

    if (!result.success) {
      const fieldErrors = parseProfileIssues(result.error.issues);

      setErrors((prev) => ({
        ...prev,
        [field]: fieldErrors[field] || "",
      }));
    } else {
      setErrors((prev) => ({
        ...prev,
        [field]: "",
      }));
    }
  };

  const handleSave = async () => {
    // Final validation before save
    if (!validationResult.success) {
      setErrors(parseProfileIssues(validationResult.error.issues));
      return;
    }
    setSaveState("saving");
    const result = await updateUserProfile({
      ...normalizedProfile,
      isOnboarded: true,
    });
    if (result) {
      setSaveState("saved");
      toast.success("Profile saved successfully!");
      setTimeout(() => setSaveState("idle"), 3000);
    } else {
      setSaveState("idle");
      toast.error("Failed to save profile");
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Sticky Header ── */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="rounded-xl text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-sm font-bold text-gray-900">
                Company Profile
              </h1>
              <p className="text-xs text-gray-400">
                Auto-fills your invoices · {completionPercent}% complete
              </p>
            </div>
          </div>
        </div>
        <div className="h-0.5 bg-gray-100">
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Account banner */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4 flex items-center gap-4">
          <Avatar className="w-10 h-10 flex-shrink-0">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="bg-indigo-600 text-white font-bold text-sm">
              {user?.firstName?.[0]?.toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-900">
              {user?.fullName || user?.firstName || "Your Account"}
            </p>
            <p className="text-xs text-indigo-400 truncate">
              {user?.emailAddresses?.[0]?.emailAddress}
            </p>
          </div>
          <Badge className="text-xs text-indigo-500 bg-white border border-indigo-200 rounded-full font-normal hover:bg-white">
            Synced via Clerk
          </Badge>
        </div>

        {/* Company Details */}
        <Section icon={Building2} title="Company Details">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FieldWrapper
                label="Company / Freelancer Name"
                required
                error={errors.businessName}
              >
                <Input
                  value={profile.businessName}
                  onChange={(e) => handleChange("businessName", e.target.value)}
                  placeholder="Enter company name"
                  className={fieldClass(!!errors.businessName)}
                />
              </FieldWrapper>
            </div>
            <FieldWrapper label="GSTIN" error={errors.gstin}>
              <Input
                value={profile.gstin}
                onChange={(e) =>
                  handleChange("gstin", e.target.value.toUpperCase())
                }
                placeholder="Enter GSTIN"
                maxLength={15}
                className={fieldClass(!!errors.gstin)}
              />
            </FieldWrapper>
            <FieldWrapper label="PAN" error={errors.pan}>
              <Input
                value={profile.pan}
                onChange={(e) =>
                  handleChange("pan", e.target.value.toUpperCase())
                }
                placeholder="Enter PAN No."
                maxLength={10}
                className={fieldClass(!!errors.pan)}
              />
            </FieldWrapper>
            <FieldWrapper label="Phone" error={errors.phone}>
              <Input
                value={profile.phone}
                onChange={(e) =>
                  handleChange(
                    "phone",
                    e.target.value.replace(/\D/g, "").slice(0, 10)
                  )
                }
                placeholder="Enter phone no."
                maxLength={10}
                inputMode="numeric"
                className={fieldClass(!!errors.phone)}
              />
            </FieldWrapper>
          </div>
        </Section>

        {/* Company Address */}
        <Section icon={MapPin} title="Company Address">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FieldWrapper label="Address" required error={errors.address}>
                <Input
                  value={profile.address}
                  onChange={(e) => handleChange("address", e.target.value)}
                  placeholder="Enter address"
                  className={fieldClass(!!errors.address)}
                />
              </FieldWrapper>
            </div>
            <FieldWrapper label="City" required error={errors.city}>
              <Input
                value={profile.city}
                onChange={(e) =>
                  handleChange(
                    "city",
                    e.target.value.replace(/[^a-zA-Z\s]/g, "")
                  )
                }
                placeholder="Enter city"
                className={fieldClass(!!errors.city)}
              />
            </FieldWrapper>
            <FieldWrapper label="State" required error={errors.state}>
              <Popover
                open={openStateDropdown}
                onOpenChange={setOpenStateDropdown}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className={`w-full justify-between ${fieldClass(
                      !!errors.state
                    )}`}
                  >
                    {profile.state || "Select state"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>

                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search state..." />

                    <CommandEmpty>No state found.</CommandEmpty>

                    <CommandGroup className="max-h-60 overflow-y-auto">
                      {INDIAN_STATES.map((state) => (
                        <CommandItem
                          key={state}
                          value={state}
                          onSelect={(currentValue) => {
                            handleChange("state", currentValue);
                            setOpenStateDropdown(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              profile.state === state
                                ? "opacity-100"
                                : "opacity-0"
                            }`}
                          />
                          {state}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </FieldWrapper>
            <FieldWrapper label="Pincode" required error={errors.pincode}>
              <Input
                value={profile.pincode}
                onChange={(e) =>
                  handleChange(
                    "pincode",
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                placeholder="Enter pinCode"
                maxLength={6}
                inputMode="numeric"
                className={fieldClass(!!errors.pincode)}
              />
            </FieldWrapper>
          </div>
        </Section>

        {/* Bank Details */}
        <Section icon={Landmark} title="Bank Details">
          <p className="text-xs text-gray-400 mb-4">
            Shown on invoice for direct bank transfers
          </p>
          <div className="grid grid-cols-2 gap-4">
            <FieldWrapper label="Bank Name" error={errors.bankName}>
              <Input
                value={profile.bankName}
                onChange={(e) =>
                  handleChange(
                    "bankName",
                    e.target.value.replace(/[^a-zA-Z\s&.]/g, "")
                  )
                }
                placeholder="Enter bank name"
                className={fieldClass(!!errors.bankName)}
              />
            </FieldWrapper>
            <FieldWrapper label="Account Number" error={errors.accountNumber}>
              <Input
                value={profile.accountNumber}
                onChange={(e) =>
                  handleChange(
                    "accountNumber",
                    e.target.value.replace(/\D/g, "").slice(0, 18)
                  )
                }
                placeholder="Enter account number"
                maxLength={18}
                inputMode="numeric"
                className={fieldClass(!!errors.accountNumber)}
              />
            </FieldWrapper>
            <FieldWrapper label="IFSC Code" error={errors.ifscCode}>
              <Input
                value={profile.ifscCode}
                onChange={(e) =>
                  handleChange(
                    "ifscCode",
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 11)
                  )
                }
                placeholder="Enter IFSC code"
                maxLength={11}
                className={fieldClass(!!errors.ifscCode)}
              />
            </FieldWrapper>
            <FieldWrapper label="UPI ID" error={errors.upiId}>
              <Input
                value={profile.upiId}
                onChange={(e) =>
                  handleChange("upiId", e.target.value.replace(/\s/g, ""))
                }
                placeholder="Enter UPI ID"
                className={fieldClass(!!errors.upiId)}
              />
            </FieldWrapper>
          </div>
        </Section>

        {/* Info hint */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-700">
                How this appears on invoices
              </p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Your business name, GSTIN, address and bank details will
                automatically appear on every PDF invoice you generate.
              </p>
            </div>
          </div>
        </div>

        {/* Save button */}
        <Button
          onClick={handleSave}
          disabled={saveState === "saving" || !validationResult.success}
          className="w-full rounded-2xl py-3 h-auto gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          style={{ boxShadow: "0 4px 12px rgba(79,70,229,0.3)" }}
        >
          {saveState === "saving" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saveState === "saved" ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
            ? "Profile Saved!"
            : "Save Profile"}
        </Button>
      </div>
    </div>
  );
}

// ── Helper components ──

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
        <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-indigo-600" />
        </div>
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldWrapper({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-gray-500">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
