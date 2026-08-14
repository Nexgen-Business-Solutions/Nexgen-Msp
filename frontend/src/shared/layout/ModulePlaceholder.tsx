import React from 'react';
import type { LucideIcon } from 'lucide-react';

const ModulePlaceholder: React.FC<{ icon: LucideIcon; title: string; description: string }> = ({
  icon: Icon,
  title,
  description,
}) => (
  <div className="p-6">
    <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <Icon size={48} className="mx-auto mb-4 text-gray-400" />
        <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-gray-600">{description}</p>
      </div>
    </div>
  </div>
);

export default ModulePlaceholder;
