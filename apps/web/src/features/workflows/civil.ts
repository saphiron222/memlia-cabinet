/** Civil dates are calendar values, never browser-local instants. */
export function formatCivilDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}
