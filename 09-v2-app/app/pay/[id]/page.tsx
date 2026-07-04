// /pay/[id] — the borrower-facing self-service payment page a link resolves to.
// Verifies the HMAC signature in the URL before showing anything. The "Pay now (sandbox)"
// button simulates the gateway leg so the whole closure flow can be demonstrated.

import { findPaymentLink, findLoanByLoanId } from "@/lib/db";
import { verifyLink } from "@/lib/payments";
import { maskName } from "@/lib/audit";
import PayButton from "./pay-button";

export default async function PayPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { id } = await params;
  const { sig } = await searchParams;
  const link = findPaymentLink(id);
  const valid = link && sig && verifyLink(link.id, link.loanId, link.amount, sig);

  if (!link || !valid) {
    return (
      <main className="max-w-md mx-auto mt-16 rounded-xl border bg-white p-6">
        <h1 className="text-lg font-semibold text-red-700">Invalid or tampered payment link</h1>
        <p className="text-sm text-slate-600 mt-2">Please request a fresh link from the bank.</p>
      </main>
    );
  }

  const expired = Date.parse(link.expiresAt) < Date.now();
  const loan = findLoanByLoanId(link.loanId);

  return (
    <main className="max-w-md mx-auto mt-16 rounded-xl border bg-white p-6 space-y-4">
      <h1 className="text-lg font-semibold">SKVCB · Secure Payment</h1>
      <div className="text-sm space-y-1">
        <div>Loan: <b>{link.loanId}</b>{loan && <> · {maskName(loan.customer.name)}</>}</div>
        <div>Purpose: <b>{link.purpose}</b></div>
        <div className="text-2xl font-bold">₹{link.amount.toLocaleString("en-IN")}</div>
        <div className="text-slate-500">
          {link.status === "PAID" ? "✅ Already paid — thank you." :
           expired ? "⚠️ This link has expired. Please request a fresh one." :
           `Valid until ${new Date(link.expiresAt).toLocaleString()}`}
        </div>
      </div>
      {link.status !== "PAID" && !expired && (
        <div className="space-y-2">
          <a href={link.upiDeepLink}
             className="block text-center rounded bg-emerald-600 text-white py-2 text-sm font-medium">
            Pay with any UPI app
          </a>
          <PayButton linkId={link.id} />
        </div>
      )}
    </main>
  );
}
