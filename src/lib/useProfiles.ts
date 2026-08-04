"use client";

import { useSyncExternalStore } from "react";
import {
  subscribe,
  loadProfiles,
  getActiveId,
  serverProfiles,
  serverActiveId,
} from "./profiles";

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
