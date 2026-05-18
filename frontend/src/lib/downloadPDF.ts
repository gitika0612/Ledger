import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { InvoicePDF } from "@/components/invoice/pdf/InvoicePDF";
import { ParsedInvoice } from "@/components/invoice/InvoicePreviewCard";
import { UserProfile } from "@/hooks/useAuth";

export async function downloadInvoicePDF(
  invoice: ParsedInvoice,
  invoiceNumber: string,
  userName: string
) {
  const element = createElement(InvoicePDF, {
    invoice,
    invoiceNumber,
    userName,
  });

  // @ts-expect-error — react-pdf types are strict but this works correctly at runtime
  const blob = await pdf(element).toBlob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${invoiceNumber}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function generateInvoicePDFBase64(
  invoice: ParsedInvoice,
  invoiceNumber: string,
  userName: string,
  profile: UserProfile | null
): Promise<string> {
  const element = createElement(InvoicePDF, {
    invoice,
    invoiceNumber,
    userName,
    profile,
  });

  // @ts-expect-error — react-pdf types are strict but this works correctly at runtime
  const blob = await pdf(element).toBlob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:application/pdf;base64," prefix
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
