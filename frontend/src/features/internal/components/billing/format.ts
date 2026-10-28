/** How Billing writes money and dates, in one place for every screen. */

/**
 * An amount the way it was handed down, direction included.
 *
 * The server settles which way a figure points — a credit deducts, a charge adds — so this
 * prints the sign it is given and never decides one. A screen that added its own minus to a
 * figure already negative would turn a credit back into a charge, which is the whole reason
 * the rule lives in one place.
 */
export const money = (amount: number | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined
    ? '—'
    : `${amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency ?? ''}`.trim();

export const day = (value?: string | null) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
