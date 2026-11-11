import { Link } from '../router';

/** The Socratic logo. On light pages: the full lockup. On dark pages: the symbol plus a cream wordmark. */
export const Logo: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <Link to="/" className="inline-flex items-center" aria-label="Socratic home">
    {dark ? (
      <span className="inline-flex items-center gap-2">
        <img src="/brand/symbol-on-dark.png" alt="" className="h-9 w-9 rounded-lg" />
        <img src="/brand/wordmark.png" alt="Socratic" className="h-7 w-auto brightness-0 invert" />
      </span>
    ) : (
      <img src="/brand/lockup.png" alt="Socratic" className="h-9 w-auto" />
    )}
  </Link>
);
