import { Cpu, Flame, Laptop, Monitor, Server, Smartphone, Tablet, type LucideIcon } from 'lucide-react';

const DEVICE_ICON: Record<string, LucideIcon> = {
  Laptop,
  PC: Monitor,
  'Mini PC': Cpu,
  Mac: Laptop,
  Phone: Smartphone,
  Tablet,
  Server,
  Firewall: Flame,
  VM: Cpu,
};

/** The picture for a kind of machine; an unknown kind is drawn as a laptop. */
export const deviceIcon = (deviceType?: string | null): LucideIcon =>
  DEVICE_ICON[deviceType ?? ''] ?? Laptop;
