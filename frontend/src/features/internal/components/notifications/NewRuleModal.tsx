import React from 'react';
import { BellPlus, ChevronRight } from 'lucide-react';
import Modal from '@/shared/components/Modal';

type Props = {
  open: boolean;
  keys: string[];
  onClose: () => void;
  onPick: (ruleKey: string) => void;
};

const NewRuleModal: React.FC<Props> = ({ open, keys, onClose, onPick }) => (
  <Modal
    open={open}
    onClose={onClose}
    icon={BellPlus}
    title="New rule"
    subtitle="Set up a notification this application already sends."
    widthClass="max-w-lg"
  >
    {keys.length === 0 ? (
      <p className="text-sm text-slate-500">Every notification this application owns is already configured.</p>
    ) : (
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200/70">
        {keys.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onPick(key)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:bg-blue-50"
            >
              <span className="min-w-0 truncate">{key}</span>
              <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    )}
  </Modal>
);

export default NewRuleModal;
