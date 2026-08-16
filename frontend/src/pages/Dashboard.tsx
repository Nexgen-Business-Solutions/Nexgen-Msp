import { LayoutDashboard } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <LayoutDashboard size={48} className="mx-auto mb-4 text-gray-400" />
          <h3 className="mb-2 text-lg font-semibold text-gray-900">Dashboard</h3>
          <p className="text-gray-600">This module is not built yet.</p>
        </div>
      </div>
    </div>
  );
}
