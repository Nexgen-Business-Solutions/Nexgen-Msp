import type { RequestDetail } from '@/lib/api/internal';

export type Want = {
  idx: number;
  service: string;
  field: 'serial_number' | 'username';
  subject: string;
  /** what the customer already told us, if they happened to know it */
  suggested?: string;
};

/** What a service still owes before it can be called delivered, asked for where it is due.
 *
 * A customer is never asked for a serial or an account name, but some of them know one and
 * say so when they raise the request. That answer is carried through to here rather than
 * left on the line for somebody to notice: the technician confirms it instead of typing it.
 */
export const outstanding = (request: RequestDetail): Want[] => {
  const wants: Want[] = [];

  for (const line of request.lines) {
    const service = line.requested_service_name || line.requested_service;

    if (line.needs_serial) {
      wants.push({
        idx: line.idx,
        service,
        field: 'serial_number',
        subject: line.device_hostname || 'this machine',
        suggested: line.new_device_serial || undefined,
      });
    }

    if (line.needs_username) {
      wants.push({
        idx: line.idx,
        service,
        field: 'username',
        subject: line.client_user_name || 'this person',
        suggested: line.new_user_username || undefined,
      });
    }
  }

  return wants;
};
