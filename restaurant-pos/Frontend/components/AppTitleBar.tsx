import { useState, useRef, useEffect } from 'react';
import { UtensilsCrossed, Wifi, WifiOff, Building2, ChevronDown, Crown, Store } from 'lucide-react';
import type { Branch } from '../src/types';
import { useCurrentTime } from '../src/hooks/useCurrentTime';

interface AppTitleBarProps {
  restaurantName: string;
  isOnline: boolean;
  branches?: Branch[];
  currentBranchId?: string | null;
  onSetCurrentBranch?: (id: string | null) => void;
  showBranchSelector?: boolean;
}

export default function AppTitleBar({
  restaurantName, isOnline,
  branches, currentBranchId, onSetCurrentBranch,
  showBranchSelector
}: AppTitleBarProps) {
  const currentTime = useCurrentTime();
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentBranch = branches?.find(b => b.id === currentBranchId);

  // Close menu on click outside
  useEffect(() => {
    if (!isBranchMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsBranchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isBranchMenuOpen]);

  return (
    <div className="bg-[#191b23] text-white px-4 py-2 flex justify-between items-center text-xs select-none border-b border-[#2e3039] shrink-0">
      {/* Left: brand + branch selector */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center gap-2 pr-2.5 border-r border-[#2e3039]">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#2563eb] to-[#004ac6] flex items-center justify-center shadow-sm shrink-0">
            <UtensilsCrossed className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold tracking-wide text-white truncate max-w-[180px]">{restaurantName || "RESTAURANT POS"}</span>
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#2e3039] text-gray-400 uppercase tracking-wider shrink-0">
              v1.4.2
            </span>
          </div>
        </div>

        {/* Branch selector */}
        {showBranchSelector && branches && branches.length > 1 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsBranchMenuOpen(!isBranchMenuOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                isBranchMenuOpen
                  ? 'bg-[#3a3c47] ring-1 ring-[#2563eb]/60'
                  : 'bg-[#2e3039] hover:bg-[#3a3c47]'
              }`}
            >
              {currentBranch?.isHeadBranch ? (
                <Crown className="w-3 h-3 text-purple-400" />
              ) : (
                <Building2 className="w-3 h-3 text-blue-400" />
              )}
              <span className="font-medium text-white text-[10px] max-w-[120px] truncate">
                {currentBranch?.name || 'Select Branch'}
              </span>
              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isBranchMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isBranchMenuOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-52 bg-[#252732] border border-[#3a3c47] rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="p-1.5">
                  <p className="px-2.5 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Store className="w-2.5 h-2.5" /> Switch Branch
                  </p>
                  {branches.filter(b => b.isActive).map(branch => (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => {
                        onSetCurrentBranch?.(branch.id);
                        setIsBranchMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors cursor-pointer ${
                        branch.id === currentBranchId
                          ? 'bg-[#004ac6] text-white'
                          : 'text-gray-300 hover:bg-[#3a3c47]'
                      }`}
                    >
                      {branch.isHeadBranch ? (
                        <Crown className="w-3 h-3 text-purple-400 shrink-0" />
                      ) : (
                        <Building2 className="w-3 h-3 text-blue-400 shrink-0" />
                      )}
                      <span className="truncate">{branch.name}</span>
                      {branch.isHeadBranch && (
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase ml-auto shrink-0">
                          Head
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: date/time + status pills */}
      <div className="flex items-center gap-2.5 text-gray-300">
        {showBranchSelector && currentBranch && (
          <span className="text-[9px] text-blue-400 hidden md:flex items-center gap-1">
            {currentBranch.isHeadBranch ? '👑 Head Office' : `📍 ${currentBranch.name}`}
          </span>
        )}

        <span className="hidden md:inline text-gray-500">{currentTime.toLocaleDateString()}</span>
        <span className="font-mono text-gray-300 bg-[#2e3039] px-2 py-0.5 rounded-md">{currentTime.toLocaleTimeString()}</span>

        {/* Online / offline pill */}
        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider ${
          isOnline
            ? 'bg-green-500/15 text-green-400 border border-green-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>

        {!isOnline && (
          <span className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider animate-pulse">
            No Connection
          </span>
        )}

        {/* Secure mode pill */}
        <span className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#2563eb]/15 text-[#60a5fa] border border-[#2563eb]/30 text-[9px] font-bold tracking-wider">
          <span className="w-1 h-1 rounded-full bg-[#3b82f6]" />
          SECURE MODE
        </span>
      </div>
    </div>
  );
}
