/** Dollar amounts throughout the window use the spec's en-US two-decimal display. */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  return USD.format(amount);
}
