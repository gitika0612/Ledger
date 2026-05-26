import { CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export function PaymentSuccessPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "#4F46E5" }}
          >
            <Zap className="w-3.5 h-3.5 text-white" fill="white" />
          </div>
          <span className="font-semibold text-gray-900">Ledger</span>
        </div>

        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Payment Successful!
        </h2>
        <p className="text-sm text-gray-500 mb-8">
          Your payment has been received. A confirmation will be sent shortly.
        </p>

        <Button
          onClick={() => navigate("/")}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
