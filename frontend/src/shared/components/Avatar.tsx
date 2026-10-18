import React from 'react';
import { initialsOf } from '@/shared/lib/initials';

const Avatar: React.FC<{ name?: string | null; size?: 'sm' | 'lg' }> = ({ name, size = 'sm' }) => (
  <span
    aria-hidden
    className={`inline-flex shrink-0 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700 ${
      size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs'
    }`}
  >
    {initialsOf(name)}
  </span>
);

export default Avatar;
