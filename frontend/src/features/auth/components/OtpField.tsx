import React, { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

const SIZE = 6;

/** Six boxes that behave like one field: paste, arrows and backspace all work. */
const OtpField: React.FC<Props> = ({ value, onChange, onComplete, disabled, autoFocus }) => {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(SIZE, ' ').slice(0, SIZE).split('');

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus();
  }, [autoFocus]);

  const push = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, SIZE);
    onChange(clean);
    if (clean.length === SIZE) onComplete?.(clean);
    return clean;
  };

  const eraseAt = (index: number) => {
    const current = value.padEnd(SIZE, ' ').split('');
    const target = current[index].trim() ? index : Math.max(0, index - 1);

    current[target] = ' ';
    push(current.join('').replace(/\s/g, ''));
    boxes.current[target]?.focus();
  };

  const typeAt = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');

    // the box reports an empty value when its digit is taken out, which is a deletion and
    // not a no-op — returning here is what used to make backspace do nothing
    if (!typed) {
      eraseAt(index);
      return;
    }

    const current = value.padEnd(SIZE, ' ').split('');
    typed.split('').forEach((digit, offset) => {
      if (index + offset < SIZE) current[index + offset] = digit;
    });

    push(current.join('').replace(/\s/g, ''));
    boxes.current[Math.min(index + typed.length, SIZE - 1)]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" dir="ltr">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            boxes.current[index] = node;
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          value={digit.trim()}
          onChange={(event) => typeAt(index, event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            typeAt(0, event.clipboardData.getData('text'));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' || event.key === 'Delete') {
              event.preventDefault();
              eraseAt(index);
            }
            if (event.key === 'ArrowLeft' && index > 0) boxes.current[index - 1]?.focus();
            if (event.key === 'ArrowRight' && index < SIZE - 1) boxes.current[index + 1]?.focus();
          }}
          className="h-12 w-full rounded-lg border border-slate-300 bg-slate-50/60 text-center text-lg font-semibold text-slate-900 tabular-nums transition-all placeholder:text-slate-300 focus:border-blue-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
        />
      ))}
    </div>
  );
};

export default OtpField;
