import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import WorkflowStepper from './WorkflowStepper';
import { stepsInOrder } from '@/shared/lib/workflowSteps';

const LABELS = [
  { key: 'person', label: 'Person' },
  { key: 'changes', label: 'Changes' },
  { key: 'review', label: 'Review' },
];

afterEach(cleanup);

describe('one stepper, drawn the same way everywhere', () => {
  it('marks the steps before as done and the one reached as current', () => {
    render(<WorkflowStepper steps={stepsInOrder(LABELS, 1)} />);

    expect(screen.getByText('Changes').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByText('Person').closest('[aria-current]')).toBeNull();
  });

  it('only reports progress when nobody can move through it', () => {
    render(<WorkflowStepper steps={stepsInOrder(LABELS, 1)} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets somebody go back to a step they are allowed to reach', () => {
    const onGo = vi.fn();
    render(
      <WorkflowStepper steps={stepsInOrder(LABELS, 2)} canGo={(key) => key === 'person'} onGo={onGo} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Person' }));
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }));

    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onGo).toHaveBeenCalledWith('person');
  });

  it('says so when a step is passed over', () => {
    render(
      <WorkflowStepper
        steps={[
          { key: 'prepare', label: 'Prepare', state: 'skipped' },
          { key: 'execute', label: 'Execute', state: 'current' },
        ]}
      />
    );

    expect(screen.getByText(/not needed/i)).toBeInTheDocument();
  });

  it('flags a step that needs somebody, and stands on it', () => {
    render(
      <WorkflowStepper
        steps={[
          { key: 'selection', label: 'Selection', state: 'done' },
          { key: 'validation', label: 'Validation', state: 'attention' },
        ]}
      />
    );

    expect(screen.getByText('Validation').closest('[aria-current]')).toHaveAttribute(
      'aria-current',
      'step'
    );
  });
});
