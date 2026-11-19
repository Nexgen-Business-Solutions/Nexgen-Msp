import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';
import { badgeClass } from '@/shared/request/format';

afterEach(cleanup);

// The accent (theme picker) recolours every blue-* class, so a status meaning "being worked on"
// must use the fixed info palette, or under Amber it would look like a "waiting" status.
it('keeps "being worked on" statuses off the accent colour', () => {
  render(<StatusBadge value="In Progress" />);
  expect(screen.getByText('IN PROGRESS')).toHaveClass('bg-info-100', 'text-info-700');
  expect(badgeClass('blue')).toContain('text-info-700');
  expect(badgeClass('blue')).not.toMatch(/blue-/);
});
