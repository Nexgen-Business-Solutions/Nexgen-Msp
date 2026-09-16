import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ExportColumnsModal from './ExportColumnsModal';
import { INTERNAL_USERS } from '../exportColumns';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const open = (onExport = vi.fn()) => {
  render(
    <ExportColumnsModal
      open
      catalogue={INTERNAL_USERS}
      onClose={() => {}}
      onExport={onExport}
    />
  );

  return onExport;
};

const tick = (label: string, section?: string) =>
  section
    ? within(screen.getByRole('group', { name: section })).getByRole('checkbox', { name: label })
    : screen.getByRole('checkbox', { name: label });

describe('the columns an export comes out with', () => {
  it('starts on what the sheet has always carried, and keeps what is always written', () => {
    open();

    expect(tick('User', 'Identity')).toBeChecked();
    expect(tick('User', 'Identity')).toBeDisabled();
    expect(tick('Remarks')).toBeChecked();
    expect(tick('Reference')).not.toBeChecked();
  });

  it('sends the picks in the order the catalogue names them', () => {
    const onExport = open();

    fireEvent.click(tick('Reference'));
    fireEvent.click(tick('Remarks', 'Notes'));
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    const [choice] = onExport.mock.calls[0];
    expect(choice.columns).toContain('name');
    expect(choice.columns).not.toContain('remarks');
    expect(choice.columns.indexOf('full_name')).toBeLessThan(choice.columns.indexOf('department'));
  });

  it('takes the services one block at a time, only when asked', () => {
    const onExport = open();

    expect(tick('Since', 'Per service')).not.toBeChecked();
    fireEvent.click(tick('Since', 'Per service'));
    fireEvent.click(tick('Last billed on', 'Per service'));
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    const [choice] = onExport.mock.calls[0];
    expect(choice.serviceColumns).toEqual(['effective_start_date', 'last_billed_on']);
  });

  it('remembers the last choice and gives it back on reset', () => {
    const first = open();
    fireEvent.click(tick('Email'));
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(first.mock.calls[0][0].columns).not.toContain('email');

    cleanup();
    const second = open();
    expect(tick('Email')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(tick('Email')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(second.mock.calls[0][0].columns).toContain('email');
  });
});
