import React from 'react';
import { ExternalLink } from 'lucide-react';

type Props = {
  /** the record to open, when there is one: without it the label stays plain text */
  name?: string | null;
  kind: 'user' | 'device';
  children?: React.ReactNode;
  className?: string;
};

/**
 * The name of a person or a machine, opened in a tab of its own.
 *
 * A request is read and acted on in one place, and leaving it to look something up would cost
 * the work in progress — a half-built draft, a scope chosen, a row half decided. So the file
 * opens beside it and this page stays exactly where it was.
 */
const RecordLink: React.FC<Props> = ({ name, kind, children, className = '' }) => {
  if (!name) return <>{children}</>;

  return (
    <a
      href={`/msp/${kind === 'user' ? 'users' : 'devices'}/${encodeURIComponent(name)}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${name} in a new tab`}
      onClick={(event) => event.stopPropagation()}
      className={`group/record inline-flex max-w-full items-center gap-1 hover:text-blue-700 hover:underline ${className}`}
    >
      {children !== undefined && <span className="truncate">{children}</span>}
      <ExternalLink
        size={11}
        className="shrink-0 text-slate-300 transition-colors group-hover/record:text-blue-600"
      />
    </a>
  );
};

export default RecordLink;
