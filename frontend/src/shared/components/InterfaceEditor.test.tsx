import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InterfaceEditor from './InterfaceEditor';

afterEach(cleanup);

describe('network interfaces, as a name and a value', () => {
  it('lets the technician name the interface and give its value', () => {
    const onChange = vi.fn();
    render(<InterfaceEditor value={[{ interface_type: 'Wi-Fi', mac_address: '' }]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Interface 1 name'), { target: { value: 'Custom MAC' } });
    expect(onChange).toHaveBeenLastCalledWith([{ interface_type: 'Custom MAC', mac_address: '' }]);

    fireEvent.change(screen.getByLabelText('Interface 1 value'), { target: { value: 'AA-BB' } });
    expect(onChange).toHaveBeenLastCalledWith([{ interface_type: 'Wi-Fi', mac_address: 'AA-BB' }]);
  });

  it('adds an empty pair and removes one', () => {
    const onChange = vi.fn();
    const two = [
      { interface_type: 'Wi-Fi', mac_address: '1' },
      { interface_type: 'LAN', mac_address: '2' },
    ];
    render(<InterfaceEditor value={two} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /add interface/i }));
    expect(onChange).toHaveBeenLastCalledWith([...two, { interface_type: '', mac_address: '' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove interface 1' }));
    expect(onChange).toHaveBeenLastCalledWith([two[1]]);
  });
});
