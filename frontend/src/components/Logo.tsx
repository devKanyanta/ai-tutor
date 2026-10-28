import { Link } from '../router';

/** Wordmark: a chalkboard tile with a serif "S", then the name. */
export const Logo: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <Link to="/" className="inline-flex items-center gap-2.5" aria-label="Socratic home">
    <span className={`flex h-8 w-8 items-center justify-center rounded-md font-serif text-lg font-bold ${dark ? 'bg-[#f6f2e9] text-board-900' : 'bg-board-800 text-[#f6f2e9]'}`}>S</span>
    <span className={`font-serif text-xl font-semibold tracking-tight ${dark ? 'text-[#f6f2e9]' : 'text-ink-900'}`}>Socratic</span>
  </Link>
);
