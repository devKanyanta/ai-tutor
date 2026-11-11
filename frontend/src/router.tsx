import { useEffect, useState } from 'react';

export type Route = '/' | '/learn' | '/studio' | '/contact';
const ROUTES: Route[] = ['/', '/learn', '/studio', '/contact'];

const currentRoute = (): Route => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as string[]).includes(path) ? (path as Route) : '/';
};

const currentUrl = () => window.location.pathname + window.location.search;

/** A route, optionally with a query string such as "/learn?tutor=abc". */
export type Destination = Route | `${Route}?${string}`;

export function navigate(to: Destination) {
  if (to === currentUrl()) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** One query-string parameter of the current URL, kept in sync with navigation. */
export function useQueryParam(name: string): string {
  const read = () => new URLSearchParams(window.location.search).get(name) ?? '';
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return value;
}

/** A real <a> (open in new tab, copy link) that navigates without a page reload. */
export const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: Destination }> = ({ to, onClick, children, ...rest }) => (
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
