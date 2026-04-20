// React glue for the pure shortcut dispatcher. Provides:
//   <ShortcutsProvider>         mounts the global keydown listener
//   useShortcuts(context, ...)  register bindings scoped to a context
//   useShortcutSurface(context) pointer-enter/leave pushes/pops the
//                               context from the active stack, so surface-
//                               local bindings fire only when the pointer
//                               is over the surface.
//
// Pattern lifted from motion-canvas/packages/ui/src/contexts/shortcuts.tsx.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { dispatchBindings, type ShortcutBinding } from "../utils/shortcuts";

type ShortcutsApi = {
  register: (binding: ShortcutBinding) => () => void;
  pushContext: (context: string) => () => void;
};

const ShortcutsContext = createContext<ShortcutsApi | null>(null);

export const ShortcutsProvider = ({
  rootContext = "global",
  children,
}: {
  rootContext?: string;
  children: ReactNode;
}) => {
  const bindingsRef = useRef<ShortcutBinding[]>([]);
  const stackRef = useRef<string[]>([rootContext]);

  const register = useCallback((binding: ShortcutBinding) => {
    bindingsRef.current.push(binding);
    return () => {
      const i = bindingsRef.current.indexOf(binding);
      if (i !== -1) bindingsRef.current.splice(i, 1);
    };
  }, []);

  const pushContext = useCallback((context: string) => {
    stackRef.current.push(context);
    return () => {
      // Remove the most-recent occurrence of this context; multiple nested
      // pushes of the same context are a no-op on unregister (refcounted by
      // caller).
      for (let i = stackRef.current.length - 1; i >= 0; i--) {
        if (stackRef.current[i] === context) {
          stackRef.current.splice(i, 1);
          break;
        }
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const fired = dispatchBindings(e, stackRef.current, bindingsRef.current);
      if (fired) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const api = useMemo(() => ({ register, pushContext }), [register, pushContext]);

  return <ShortcutsContext.Provider value={api}>{children}</ShortcutsContext.Provider>;
};

export const useShortcuts = (
  context: string,
  bindings: Array<Omit<ShortcutBinding, "context">>,
): void => {
  const api = useContext(ShortcutsContext);
  useEffect(() => {
    if (!api) return;
    const unregisters = bindings.map((b) => api.register({ ...b, context }));
    return () => {
      for (const u of unregisters) u();
    };
    // Caller is responsible for memoizing bindings; re-registration on
    // every render is safe but wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, context, bindings.map]);
};

// Returns pointer handlers that push/pop a context onto the active stack.
// Spread them onto whatever div represents the surface.
export const useShortcutSurface = (
  context: string,
): {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
} => {
  const api = useContext(ShortcutsContext);
  const popRef = useRef<(() => void) | null>(null);
  return {
    onPointerEnter: () => {
      if (!api || popRef.current) return;
      popRef.current = api.pushContext(context);
    },
    onPointerLeave: () => {
      if (popRef.current) {
        popRef.current();
        popRef.current = null;
      }
    },
  };
};
