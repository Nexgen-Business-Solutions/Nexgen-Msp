/** How Billing writes money and dates, in one place for every screen. */

export const money = (amount: number | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined
    ? '—'
    : `${Math.abs(amount).toLocaleString('en-US', {
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
