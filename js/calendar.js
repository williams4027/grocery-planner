/* Google Calendar handoff — pure builders, no DOM, no network. */

import { AISLES } from './config.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

function quantityLabel(item) {
  const parts = [];
  if (item.qty !== null && item.qty !== undefined) parts.push(String(item.qty));
  if (item.unit) parts.push(item.unit);
  return parts.join(' ');
}

function compareItems(a, b) {
  if (a.checked !== b.checked) return a.checked ? 1 : -1;
  return String(a.addedAt).localeCompare(String(b.addedAt));
}

/** Plain-text list grouped in the store's aisle order, for an event description. */
export function buildTripDetails(list) {
  if (!list) return '';

  const items = (Array.isArray(list.items) ? list.items : []).filter(
    (item) => item && !item.deletedAt && item.name
  );
  const order =
    Array.isArray(list.aisleOrder) && list.aisleOrder.length ? list.aisleOrder : AISLES;
  const buckets = new Map();

  for (const item of items) {
    const aisle = order.includes(item.aisle) ? item.aisle : 'Other';
    if (!buckets.has(aisle)) buckets.set(aisle, []);
    buckets.get(aisle).push(item);
  }

  for (const group of buckets.values()) group.sort(compareItems);

  const picked = items.filter((item) => item.checked).length;
  const lines = [
    `${list.name || 'Groceries'} — ${items.length} item${items.length === 1 ? '' : 's'}${
      picked ? ` (${picked} picked)` : ''
    }`,
    '',
  ];

  if (!items.length) {
    lines.push('No items yet.', '');
  } else {
    for (const aisle of order) {
      const group = buckets.get(aisle);
      if (!group || !group.length) continue;

      lines.push(aisle);
      for (const item of group) {
        const quantity = quantityLabel(item);
        lines.push(
          `${item.checked ? '[x]' : '[ ]'} ${item.name}${quantity ? ` — ${quantity}` : ''}`
        );
      }
      lines.push('');
    }
  }

  lines.push('From Grocery Planner');
  return lines.join('\n').trim();
}

function parseLocalDateTime(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) {
    return null;
  }

  const value = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(value.getTime())) return null;

  // Reject rollovers such as February 30.
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day
  ) {
    return null;
  }

  return value;
}

function formatLocal(value) {
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}T${pad(
    value.getHours()
  )}${pad(value.getMinutes())}00`;
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (error) {
    return 'UTC';
  }
}

/**
 * Builds a prefilled Google Calendar event link. Google's page is the only
 * network destination; the user still reviews and saves the event there.
 */
export function buildGoogleCalendarUrl({
  list,
  title,
  date,
  time,
  timeZone = null,
  durationMinutes = 60,
} = {}) {
  if (!list) throw new Error('There is no list to export.');

  const start = parseLocalDateTime(date, time);
  if (!start) throw new Error('Choose a valid date and time.');

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', String(title || '').trim() || `${list.name} trip`);
  params.set('details', buildTripDetails(list));
  params.set('dates', `${formatLocal(start)}/${formatLocal(end)}`);
  params.set('ctz', timeZone || browserTimeZone());

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
