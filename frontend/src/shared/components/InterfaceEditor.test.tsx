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

  it('punctuates the address while it is being typed', () => {
    const onChange = vi.fn();
    render(<InterfaceEditor value={[{ interface_type: 'Wi-Fi', mac_address: '' }]} onChange={onChange} />);
    const written = screen.getByLabelText('Interface 1 value');

    fireEvent.change(written, { target: { value: '0aea311a95bb' } });
    expect(onChange).toHaveBeenLastCalledWith([
      { interface_type: 'Wi-Fi', mac_address: '0A-EA-31-1A-95-BB' },
    ]);

    fireEvent.change(written, { target: { value: '0A:EA:31:1A:95:BB' } });
    expect(onChange).toHaveBeenLastCalledWith([
      { interface_type: 'Wi-Fi', mac_address: '0A-EA-31-1A-95-BB' },
    ]);

    // the hyphens appear as the digits do, and nothing past the sixth octet is taken
    fireEvent.change(written, { target: { value: '0aea3' } });
    expect(onChange).toHaveBeenLastCalledWith([{ interface_type: 'Wi-Fi', mac_address: '0A-EA-3' }]);

    fireEvent.change(written, { target: { value: '0aea311a95bbcc' } });
    expect(onChange).toHaveBeenLastCalledWith([
      { interface_type: 'Wi-Fi', mac_address: '0A-EA-31-1A-95-BB' },
    ]);
  });

  it('lets a backspace keep deleting', () => {
    const onChange = vi.fn();
    render(<InterfaceEditor value={[{ interface_type: 'Wi-Fi', mac_address: '0A-EA' }]} onChange={onChange} />);

    // what the browser hands over once the typist has rubbed out the trailing character
    fireEvent.change(screen.getByLabelText('Interface 1 value'), { target: { value: '0A-E' } });

    expect(onChange).toHaveBeenLastCalledWith([{ interface_type: 'Wi-Fi', mac_address: '0A-E' }]);
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
