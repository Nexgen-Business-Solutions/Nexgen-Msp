import { createContext, useContext, useEffect } from 'react';

/** What a detail page puts at the end of the trail, in place of its section's own title. */
export type PageHeading = { crumb: string } | null;

export const PageHeadingContext = createContext<{
  heading: PageHeading;
  setHeading: (heading: PageHeading) => void;
}>({ heading: null, setHeading: () => {} });

export const usePageHeading = () => useContext(PageHeadingContext);

export const useSetPageHeading = (crumb: string | null | undefined) => {
  const { setHeading } = usePageHeading();

  useEffect(() => {
    if (!crumb) return;

    setHeading({ crumb });

    return () => setHeading(null);
  }, [crumb, setHeading]);
};
