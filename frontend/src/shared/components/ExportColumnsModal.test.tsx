import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ExportColumnsModal from './ExportColumnsModal';
import {
  INTERNAL_DEVICES,
  INTERNAL_USERS,
  PORTAL_DEVICES,
  PORTAL_USERS,
  ordered,
  sectionsOf,
} from '../exportColumns';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const open = (onExport = vi.fn(), onClose = vi.fn()) => {
  render(
    <ExportColumnsModal
      open
      catalogue={INTERNAL_USERS}
      onClose={onClose}
      onExport={onExport}
    />
  );

  return onExport;
};

const exportNow = () => fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

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

  it('sends the picks in the order the catalogue names them', async () => {
    const onExport = open();

    fireEvent.click(tick('Reference'));
    fireEvent.click(tick('Remarks', 'Notes'));
    exportNow();
    await waitFor(() => expect(onExport).toHaveBeenCalled());

    const [choice] = onExport.mock.calls[0];
    expect(choice.columns).toContain('name');
    expect(choice.columns).not.toContain('remarks');
    expect(choice.columns.indexOf('full_name')).toBeLessThan(choice.columns.indexOf('department'));
  });

  it('takes the services one block at a time, only when asked', async () => {
    const onExport = open();

    expect(tick('Since', 'Per service')).not.toBeChecked();
    fireEvent.click(tick('Since', 'Per service'));
    fireEvent.click(tick('Last billed on', 'Per service'));
    exportNow();
    await waitFor(() => expect(onExport).toHaveBeenCalled());

    const [choice] = onExport.mock.calls[0];
    expect(choice.serviceColumns).toEqual(['effective_start_date', 'last_billed_on']);
  });

  it('remembers the last choice and gives it back on reset', async () => {
    const first = open();
    fireEvent.click(tick('Email'));
    exportNow();
    await waitFor(() => expect(first).toHaveBeenCalled());
    expect(first.mock.calls[0][0].columns).not.toContain('email');

    cleanup();
    const second = open();
    expect(tick('Email')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(tick('Email')).toBeChecked();
    exportNow();
    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(second.mock.calls[0][0].columns).toContain('email');
  });
});

describe('the order a sheet comes out in', () => {
  it('follows the picker, section by section, whatever was ticked first', () => {
    const picked = ordered(INTERNAL_USERS, ['remarks', 'department', 'services', 'username']);

    expect(picked).toEqual(['full_name', 'username', 'department', 'services', 'remarks']);
  });

  it('lays every catalogue out one section at a time, so the file reads like the modal', () => {
    for (const catalogue of [INTERNAL_USERS, INTERNAL_DEVICES, PORTAL_USERS, PORTAL_DEVICES]) {
      const sections = sectionsOf(catalogue.columns);
      const seen = catalogue.columns.map((column) => sections.indexOf(column.section));

      expect(seen, catalogue.id).toEqual([...seen].sort((a, b) => a - b));
    }
  });

  it('keeps the defaults in the picker order', () => {
    for (const catalogue of [INTERNAL_USERS, INTERNAL_DEVICES, PORTAL_USERS, PORTAL_DEVICES]) {
      expect(ordered(catalogue, catalogue.defaults), catalogue.id).toEqual(
        ordered(catalogue, [...catalogue.defaults].reverse())
      );
    }
  });
});

describe('waiting for the file', () => {
  it('says it is working and stays open until the sheet is there', async () => {
    let hand: () => void = () => {};
    const onClose = vi.fn();
    open(
      vi.fn(() => new Promise<void>((resolve) => {
        hand = resolve;
      })),
      onClose
    );

    exportNow();

    expect(await screen.findByRole('button', { name: /preparing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => hand());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the picks and says so when the sheet does not come through', async () => {
    const onClose = vi.fn();
    open(vi.fn().mockRejectedValue(new Error('Nothing to export.')), onClose);

    exportNow();

    expect(await screen.findByText('Nothing to export.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^export$/i })).toBeEnabled();
  });
});
