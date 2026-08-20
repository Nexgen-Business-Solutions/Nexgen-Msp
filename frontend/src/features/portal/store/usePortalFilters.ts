import { create } from 'zustand';

export type ListKey = 'clientUsers' | 'devices' | 'services' | 'requests';

export type ListFilters = {
  search: string;
  status: string;
  start: number;
  pageLength: number;
};

export const emptyFilters: ListFilters = {
  search: '',
  status: '',
  start: 0,
  pageLength: 20,
};

type PortalFiltersState = {
  customer: string | null;
  filters: Record<ListKey, ListFilters>;
  serviceFilters: Record<string, ListFilters>;
  setCustomer: (customer: string | null) => void;
  setSearch: (key: ListKey, search: string) => void;
  setStatus: (key: ListKey, status: string) => void;
  setPage: (key: ListKey, start: number) => void;
  setPageLength: (key: ListKey, pageLength: number) => void;
  nextPage: (key: ListKey) => void;
  previousPage: (key: ListKey) => void;
  getServiceFilters: (serviceItem: string) => ListFilters;
  setServiceSearch: (serviceItem: string, search: string) => void;
  setServiceStatus: (serviceItem: string, status: string) => void;
  setServicePageLength: (serviceItem: string, pageLength: number) => void;
  nextServicePage: (serviceItem: string) => void;
  previousServicePage: (serviceItem: string) => void;
  reset: (key: ListKey) => void;
  resetAll: () => void;
};

const initialFilters = (): Record<ListKey, ListFilters> => ({
  clientUsers: { ...emptyFilters },
  devices: { ...emptyFilters },
  services: { ...emptyFilters },
  requests: { ...emptyFilters },
});

const patchService = (
  state: PortalFiltersState,
  serviceItem: string,
  patch: Partial<ListFilters>
) => ({
  serviceFilters: {
    ...state.serviceFilters,
    [serviceItem]: {
      ...(state.serviceFilters[serviceItem] ?? emptyFilters),
      ...patch,
    },
  },
});

export const usePortalFilters = create<PortalFiltersState>((set, get) => ({
  customer: null,
  filters: initialFilters(),
  serviceFilters: {},

  setCustomer: (customer) =>
    set({ customer, filters: initialFilters(), serviceFilters: {} }),

  setSearch: (key, search) =>
    set((state) => ({
      filters: { ...state.filters, [key]: { ...state.filters[key], search, start: 0 } },
    })),

  setStatus: (key, status) =>
    set((state) => ({
      filters: { ...state.filters, [key]: { ...state.filters[key], status, start: 0 } },
    })),

  setPage: (key, start) =>
    set((state) => ({
      filters: { ...state.filters, [key]: { ...state.filters[key], start: Math.max(0, start) } },
    })),

  setPageLength: (key, pageLength) =>
    set((state) => ({
      filters: { ...state.filters, [key]: { ...state.filters[key], pageLength, start: 0 } },
    })),

  nextPage: (key) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: {
          ...state.filters[key],
          start: state.filters[key].start + state.filters[key].pageLength,
        },
      },
    })),

  previousPage: (key) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: {
          ...state.filters[key],
          start: Math.max(0, state.filters[key].start - state.filters[key].pageLength),
        },
      },
    })),

  getServiceFilters: (serviceItem) => get().serviceFilters[serviceItem] ?? emptyFilters,

  setServiceSearch: (serviceItem, search) =>
    set((state) => patchService(state, serviceItem, { search, start: 0 })),

  setServiceStatus: (serviceItem, status) =>
    set((state) => patchService(state, serviceItem, { status, start: 0 })),

  setServicePageLength: (serviceItem, pageLength) =>
    set((state) => patchService(state, serviceItem, { pageLength, start: 0 })),

  nextServicePage: (serviceItem) =>
    set((state) => {
      const current = state.serviceFilters[serviceItem] ?? emptyFilters;
      return patchService(state, serviceItem, { start: current.start + current.pageLength });
    }),

  previousServicePage: (serviceItem) =>
    set((state) => {
      const current = state.serviceFilters[serviceItem] ?? emptyFilters;
      return patchService(state, serviceItem, {
        start: Math.max(0, current.start - current.pageLength),
      });
    }),

  reset: (key) => set((state) => ({ filters: { ...state.filters, [key]: { ...emptyFilters } } })),

  resetAll: () => set({ filters: initialFilters(), serviceFilters: {} }),
}));
