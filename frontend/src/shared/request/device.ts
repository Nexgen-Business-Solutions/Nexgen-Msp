/**
 * How a request names a machine, in one place.
 *
 * A hostname alone is not an identification: two machines of the same person read the same way
 * on a screen, and the MSP key is not a serial number. So wherever a request points at a
 * machine it is read as `<hostname> · SN: <serial>`, and when there is no serial the reader is
 * told which kind of nothing it is — a machine already recorded without one, or one that does
 * not exist yet and cannot have one.
 */

export const SERIAL_NOT_RECORDED = 'Serial number not recorded';
export const SERIAL_NOT_ASSIGNED = 'Serial number not assigned yet';

export type MachineIdentity = {
  name?: string | null;
  hostname?: string | null;
  serial_number?: string | null;
  label?: string | null;
};

/** What the machine is called, never its serial number dressed up as a name. */
export const machineName = (machine: MachineIdentity) =>
  machine.hostname || machine.label || machine.name || 'Device';

/** The serial line of a machine: the number itself, or why there is none. */
export const machineSerial = (machine: MachineIdentity, requested = false) =>
  machine.serial_number
    ? `SN: ${machine.serial_number}`
    : requested
      ? SERIAL_NOT_ASSIGNED
      : SERIAL_NOT_RECORDED;

/** The machine as a reader identifies it, hostname and serial together. */
export const machineIdentity = (machine: MachineIdentity, requested = false) => {
  const shown = machineName(machine);

  return shown === machine.serial_number
    ? machineSerial(machine, requested)
    : `${shown} · ${machineSerial(machine, requested)}`;
};
