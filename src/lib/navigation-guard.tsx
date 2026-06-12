import { createContext, useContext, useCallback, useRef, useMemo } from "react";
import type { ReactNode } from "react";

type GuardFn = () => Promise<boolean>;

interface NavigationGuardContextValue {
  setGuard: (fn: GuardFn | null) => void;
  checkGuard: () => Promise<boolean>;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue>({
  setGuard: () => {},
  checkGuard: () => Promise.resolve(true),
});

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<GuardFn | null>(null);

  const setGuard = useCallback((fn: GuardFn | null) => {
    guardRef.current = fn;
  }, []);

  const checkGuard = useCallback(async () => {
    if (guardRef.current) {
      return guardRef.current();
    }
    return true;
  }, []);

  const value = useMemo(() => ({ setGuard, checkGuard }), [setGuard, checkGuard]);

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  return useContext(NavigationGuardContext);
}
