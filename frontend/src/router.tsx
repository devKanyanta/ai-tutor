import { useEffect, useState } from 'react';

export type Route = '/' | '/learn' | '/studio';
const ROUTES: Route[] = ['/', '/learn', '/studio'];

const current = (): Route => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as string[]).includes(path) ? (path as Route) : '/';
};

export function navigate(to: Route) {
  if (to === current()) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onPop = () => setRoute(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** A real <a> (open in new tab, copy link) that navigates without a page reload. */
export const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: Route }> = ({ to, onClick, children, ...rest }) => (
  <a
    href={to}
    onClick={(e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    }}
    {...rest}
  >
    {children}
  </a>
);
