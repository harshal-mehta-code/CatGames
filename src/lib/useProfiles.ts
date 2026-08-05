"use client";

import { useSyncExternalStore } from "react";
import {
  subscribe,
  loadProfiles,
  getActiveId,
  serverProfiles,
  serverActiveId,
} from "./profiles";

const noopSubscribe = () => () => {};

/**
 * False during server render and the hydration pass, true afterwards.
 *
 * Anything randomised at render time has to wait for this. A statically
 * prerendered page bakes its random values in at build time, so the client
 * generates different ones and hydration mismatches — which is exactly what
 * the shuffle's rotation did. Deferring via useSyncExternalStore keeps the
 * hydration render identical to the server's, then re-renders once.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Renders the built-in defaults on the server, then swaps to whatever is in
 *  localStorage once hydrated. */
export function useProfiles() {
  return useSyncExternalStore(subscribe, loadProfiles, serverProfiles);
}

export function useActiveProfile() {
  const profiles = useProfiles();
  const activeId = useSyncExternalStore(
    subscribe,
    getActiveId,
    serverActiveId,
  );
  return {
    profiles,
    activeId,
    profile: profiles.find((p) => p.id === activeId) ?? profiles[0],
  };
}
