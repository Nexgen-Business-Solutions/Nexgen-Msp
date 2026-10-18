import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** The tile that carries a section's icon, so a page reads as a list of things. */
const SectionIcon: React.FC<{ icon: LucideIcon }> = ({ icon: Icon }) => (
  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
    <Icon size={18} />
  </span>
);

export default SectionIcon;
