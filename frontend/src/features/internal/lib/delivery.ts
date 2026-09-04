import type { RequestDetail } from '@/lib/api/internal';

export type Want = {
  idx: number;
  service: string;
  field: 'serial_number' | 'username';
  subject: string;
};

/** What a service still owes before it can be called delivered, asked for where it is due. */
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
      });
    }

    if (line.needs_username) {
      wants.push({
        idx: line.idx,
        service,
        field: 'username',
        subject: line.client_user_name || 'this person',
      });
    }
  }

  return wants;
};
