import React from 'react';

const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({
  children,
  required = false,
}) => (
  <span className="mb-1.5 block text-xs font-semibold text-slate-700">
    {children}
    {required && (
      <span className="ml-0.5 text-red-500" aria-hidden="true">
        *
      </span>
    )}
  </span>
);

export default FieldLabel;
