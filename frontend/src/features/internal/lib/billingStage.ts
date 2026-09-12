export type BillingStage =
  | 'scope'
  | 'selection'
  | 'validation'
  | 'review'
  | 'invoice'
  | 'complete';

/** Where a run stands, told by its own status rather than by which page is open. */
export const stageOf = (status?: string | null, hasInvoice?: boolean): BillingStage => {
  if (status === 'Invoiced') return 'complete';
  if (status === 'Invoice Drafted' || hasInvoice) return 'invoice';
  if (status === 'Approved') return 'invoice';
  if (status === 'Exception') return 'validation';
  if (status === 'Ready for Approval') return 'review';
  if (status === 'Validating') return 'validation';

  return 'selection';
};
