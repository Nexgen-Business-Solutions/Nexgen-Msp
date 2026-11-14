/** Who or what a billed line is about, in the order a reader recognises it.
 *
 * A service the company itself holds has no person and no machine behind it, and reading
 * "N/A" where a name belongs tells a reader the line is broken rather than that it is a
 * retainer. The company is the subject, so the company is what is said.
 */
export const subjectOf = (
  line: {
    user_name?: string | null;
    hostname?: string | null;
    serial_number?: string | null;
    assignment_scope?: string | null;
  },
  customer?: string | null
) => {
  if (line.assignment_scope === 'Customer') return customer || 'Entire company';

  return line.user_name || line.hostname || line.serial_number || 'N/A';
};
