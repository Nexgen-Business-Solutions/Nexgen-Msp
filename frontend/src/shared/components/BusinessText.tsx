import React from 'react';

/**
 * A name that belongs to the business rather than to the interface.
 *
 * A browser set to translate the page translates everything it finds, including the names
 * ERPNext holds — services, companies, machines. The interface may be read in any language;
 * what is stored is read exactly as it was written, or two people are talking about
 * different things while looking at the same screen.
 */
const BusinessText: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <span translate="no" className={className ? `notranslate ${className}` : 'notranslate'}>
    {children}
  </span>
);

export default BusinessText;
