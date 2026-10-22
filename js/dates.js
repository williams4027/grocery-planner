/* Local-date helpers for week planning.
 *
 * Date keys are YYYY-MM-DD in local time. Dates are anchored at noon so
 * daylight-saving transitions cannot roll a day backward or forward.
 */

export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function fromDateKey(key) {
  if (!isValidDateKey(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date, weekStart = 'sun') {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const startDay = weekStart === 'mon' ? 1 : 0;
  const offset = (start.getDay() - startDay + 7) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

export function eachDay(start, count = 7) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}
