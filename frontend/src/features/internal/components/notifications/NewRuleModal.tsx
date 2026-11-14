import React from 'react';
import { BellPlus } from 'lucide-react';
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
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
        {keys.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onPick(key)}
              className="flex min-h-11 w-full items-center px-4 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-blue-50"
            >
              {key}
            </button>
          </li>
        ))}
      </ul>
    )}
  </Modal>
);

export default NewRuleModal;
