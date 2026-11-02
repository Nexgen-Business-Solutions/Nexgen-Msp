import { useOutletContext } from 'react-router-dom';

/** The staff workspace offers customer-scoped operational views without the request builder. */
export const useScopedWorkspace = () => useOutletContext<{ scopedStaff: boolean } | null>()?.scopedStaff === true;
