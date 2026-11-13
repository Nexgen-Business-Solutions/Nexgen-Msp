/** Who or what a billed line is about, in the order a reader recognises it. */
export const subjectOf = (line: {
  user_name?: string | null;
  hostname?: string | null;
  serial_number?: string | null;
}) => line.user_name || line.hostname || line.serial_number || 'N/A';
