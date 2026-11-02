import { LogOut } from 'lucide-react';
import { useAuth } from './AuthContext';

export const UserMenu: React.FC = () => {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="hidden max-w-[10rem] truncate px-2 font-medium text-ink-700 sm:inline" title={user.email}>{user.name}</span>
      <button onClick={() => void signOut()} className="flex items-center gap-1 rounded-md px-2 py-2 font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900" title="Sign out">
        <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
};
