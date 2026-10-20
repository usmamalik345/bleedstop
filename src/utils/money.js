/** Round money to 3 decimal places (milli-dollars). */
export function roundMoney(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

export function formatUsd(n) {
  return `$${roundMoney(n).toFixed(3)}`;
}
