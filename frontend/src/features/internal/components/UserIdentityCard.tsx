import React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import StatusBadge from '@/shared/components/StatusBadge';
import type { UserDetail } from '@/lib/api/internal';

const fmtDate = (value?: string | null) => (value ? String(value).slice(0, 10) : 'N/A');

type Props = {
  detail: UserDetail;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onNewRequest: () => void;
};

/** Who this is, at a glance, and the one thing anybody normally comes here to start. */
const UserIdentityCard: React.FC<Props> = ({
  detail,
  isAdmin,
  onEdit,
  onDelete,
  onNewRequest,
}) => {
  const { user, summary } = detail;
  const archived = user.lifecycle_status === 'Archived';

  return (
    <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold text-slate-900">{user.full_name}</h1>
            <StatusBadge value={user.lifecycle_status} />
          </div>

          <p className="mt-1 text-sm font-medium text-slate-600">{user.department || 'No department'}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {[user.email, user.username && `Username: ${user.username}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {user.customer} · in service since {fmtDate(user.start_date)}
            {user.disabled_date ? ` · disabled ${fmtDate(user.disabled_date)}` : ''}
          </p>

          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
            <span>
              <strong className="font-semibold text-slate-900">{summary.current_devices}</strong>{' '}
              devices
            </span>
            <span>
              <strong className="font-semibold text-slate-900">
                {summary.active_personal_services}
              </strong>{' '}
              personal services
            </span>
            <span>
              <strong className="font-semibold text-slate-900">
                {summary.active_device_services}
              </strong>{' '}
              device services
            </span>
            <span>
              <strong className="font-semibold text-slate-900">{summary.open_requests}</strong> open
              requests
            </span>
          </p>

          {user.portal_access !== undefined && (
            <p className="mt-2 text-xs text-slate-400">
              Portal access {user.portal_access ? 'enabled' : 'not enabled'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {!archived && (
            <button
              type="button"
              onClick={onNewRequest}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={15} />
              New request
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Pencil size={14} />
            Edit
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onDelete}
              disabled={!detail.can_delete}
              title={
                detail.can_delete
                  ? 'Erase this person'
                  : `Cannot be deleted: ${detail.delete_blockers.join(', ')}`
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>

      {archived && (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Archived users cannot receive new services or devices.
        </p>
      )}
    </section>
  );
};

export default UserIdentityCard;
