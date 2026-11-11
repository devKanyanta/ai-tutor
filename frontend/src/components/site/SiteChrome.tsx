import { Link } from '../../router';
import { Logo } from '../Logo';
import { CONTACT } from './contact';

/** Top bar shared by the public pages. Section links point at the landing page. */
export const SiteHeader: React.FC = () => (
  <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-paper/90 backdrop-blur">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
      <Logo />
      <nav aria-label="Main" className="hidden items-center gap-8 text-sm font-medium text-ink-600 md:flex">
        <a href="/#how" className="hover:text-ink-900">How it works</a>
        <a href="/#educators" className="hover:text-ink-900">Try it</a>
        <a href="/#faq" className="hover:text-ink-900">FAQ</a>
        <Link to="/contact" className="hover:text-ink-900">Contact</Link>
      </nav>
      <div className="flex items-center gap-2">
        <Link to="/contact" className="px-2 text-sm font-medium text-ink-600 hover:text-ink-900 md:hidden">Contact</Link>
        <Link to="/learn" className="btn btn-primary !py-2 text-sm">Try it free</Link>
      </div>
    </div>
  </header>
);

export const SiteFooter: React.FC = () => (
  <footer className="border-t border-ink-200 px-5 py-10 sm:px-8">
    <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
      <Logo />
      <p className="max-w-md text-sm text-ink-500">Socratic answers only from the material you give it. It is a study aid and does not replace teaching. Free trial: the full version is on its way.</p>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-ink-600">
        <Link to="/learn" className="hover:text-ink-900">Learn</Link>
        <Link to="/contact" className="hover:text-ink-900">Contact</Link>
        <a href={`mailto:${CONTACT.email}`} className="hover:text-ink-900">{CONTACT.email}</a>
        <a href={CONTACT.phoneHref} className="hover:text-ink-900">{CONTACT.phoneDisplay}</a>
        <a href={CONTACT.github} target="_blank" rel="noreferrer" className="hover:text-ink-900">GitHub {CONTACT.githubHandle}</a>
      </nav>
    </div>
  </footer>
);
