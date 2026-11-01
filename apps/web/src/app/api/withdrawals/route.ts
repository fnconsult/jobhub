import { candidatePosting, seeOther } from "@/billing/http";
import { routes } from "@/routes";
import { getWithdrawals } from "@/withdrawals/server";

/**
 * « Confirmer la rétractation » (#511): the Withdrawal form, posted from « Renoncer au contrat ici ». On to the
 * Withdrawal just recorded, or back to the form saying what to change (`erreur`: the field at fault and why, or why
 * the contract could not be withdrawn from).
 */
export async function POST(request: Request) {
  const candidate = await candidatePosting(request);
  if (!candidate) return seeOther(routes.signIn, request);
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const contract = field("contract") ?? "";
  const result = await getWithdrawals().withdraw(
    candidate,
    { contract, name: field("name"), receipt: field("receipt"), receiptEmail: field("receipt") === "other" ? field("receiptEmail") : undefined },
    candidate.locale,
  );
  if (result.ok) return seeOther(routes.withdrawalDone(result.withdrawal.id), request);
  const error = "errors" in result ? `${result.errors[0]!.field}_${result.errors[0]!.code}` : result.error;
  return seeOther(`${routes.withdrawal(contract)}&erreur=${encodeURIComponent(error)}`, request);
}
