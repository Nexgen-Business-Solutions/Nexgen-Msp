export const DEPLOYED_STATUSES = ['Active'] as const;
export const AVAILABLE_STATUSES = ['Pending', 'Stock'] as const;
export const UNAVAILABLE_STATUSES = ['Returned', 'Damaged', 'Retired', 'Lost'] as const;
export const RETIRABLE_FROM = ['Active', 'Stock', 'Damaged', 'Lost'] as const;
export const REINSTATABLE_FROM = ['Retired', 'Damaged', 'Lost', 'Returned'] as const;

export const isDeployed = (status: string) => (DEPLOYED_STATUSES as readonly string[]).includes(status);
export const isAvailable = (status: string) => (AVAILABLE_STATUSES as readonly string[]).includes(status);
export const isOutOfService = (status: string) => (UNAVAILABLE_STATUSES as readonly string[]).includes(status);
export const canRetire = (status: string) => (RETIRABLE_FROM as readonly string[]).includes(status);
export const canReinstate = (status: string) => (REINSTATABLE_FROM as readonly string[]).includes(status);
