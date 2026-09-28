import type { RequestDetailLine } from '@/lib/api/internal';

/**
 * Who a request line is for.
 *
 * Three readings used this cascade and two of them wrote it out by hand, so when it was
 * wrong it was wrong in several places at once: a person the request has still to create has
 * no record to be found under, and the machine being given to them belongs to somebody else
 * until the day it is handed over. Read by its current holder, such a line was filed under a
 * stranger — and one newcomer became one entry per machine, each showing that stranger's
 * department and email.
 *
 * So the newcomer is asked for first, and the machine's holder is only ever a last resort for
 * a line that names nobody at all.
 */

export const keyOfPerson = (line: RequestDetailLine) =>
  line.is_new_user && !line.client_user
    ? `new:${line.subject_key || line.new_user_full_name || line.idx}`
    : line.client_user ||
      line.requested_for_user ||
      line.device_holder ||
      `new:${line.new_user_full_name ?? line.idx}`;

export const nameOfPerson = (line: RequestDetailLine) =>
  (line.is_new_user && !line.client_user ? line.new_user_full_name : line.client_user_name) ||
  (line.is_new_user ? null : line.device_holder) ||
  'Unnamed person';

/** The person a line is about, or nothing when they do not exist yet. */
export const recordOfPerson = (line: RequestDetailLine) =>
  line.is_new_user && !line.client_user
    ? null
    : line.client_user || line.requested_for_user || line.device_holder || null;
