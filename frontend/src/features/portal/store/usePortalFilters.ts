import { create } from 'zustand';

export type ListKey = 'clientUsers' | 'devices' | 'services' | 'requests';

export type ListFilters = {
  search: string;
  status: string;
  start: number;
  pageLength: number;
};

const emptyFilters: ListFilters = {
  search: '',
  status: '',
  start: 0,
  pageLength: 20,
};

type PortalFiltersState = {
  customer: string | null;
  filters: Record<ListKey, ListFilters>;
  setCustomer: (customer: string | null) => void;
  setSearch: (key: ListKey, search: string) => void;
  setStatus: (key: ListKey, status: string) => void;
  setPage: (key: ListKey, start: number) => void;
  setPageLength: (key: ListKey, pageLength: number) => void;
  nextPage: (key: ListKey) => void;
  previousPage: (key: ListKey) => void;
  reset: (key: ListKey) => void;
  resetAll: () => void;
};

const initialFilters = (): Record<ListKey, ListFilters> => ({
  clientUsers: { ...emptyFilters },
  devices: { ...emptyFilters },
  services: { ...emptyFilters },
  requests: { ...emptyFilters },
});

export const usePortalFilters = create<PortalFiltersState>((set) => ({
  customer: null,
  filters: initialFilters(),

  setCustomer: (customer) => set({ customer, filters: initialFilters() }),

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

  reset: (key) =>
    set((state) => ({ filters: { ...state.filters, [key]: { ...emptyFilters } } })),

  resetAll: () => set({ filters: initialFilters() }),
}));
