"use client";

import { LivTalesApiClient } from "@livtales/api-client";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { useAuthSession } from "./auth-session";
import { liveTabId } from "./live/live-signals";

interface ApiClients {
  readonly client: LivTalesApiClient;
  /** Requests that outlive the page, sent as it is left. */
  readonly leaving: LivTalesApiClient;
}

const ApiClientContext = createContext<ApiClients | null>(null);

export function ApiClientProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { credential, signal } = useAuthSession();

  const clients = useMemo(
    () => ({
      client: new LivTalesApiClient({
        getCredential: () => credential,
        signal,
        tabId: liveTabId(),
      }),
      leaving: new LivTalesApiClient({
        getCredential: () => credential,
        signal,
        tabId: liveTabId(),
        fetch: (input, init) =>
          globalThis.fetch(input, { ...init, keepalive: true }),
      }),
    }),
    [credential, signal],
  );

  return (
    <ApiClientContext.Provider value={clients}>
      {children}
    </ApiClientContext.Provider>
  );
}

function useApiClients(): ApiClients {
  const clients = useContext(ApiClientContext);
  if (clients === null) {
    throw new Error("useApiClient must be used within ApiClientProvider.");
  }
  return clients;
}

export function useApiClient(): LivTalesApiClient {
  return useApiClients().client;
}

/** The client for a request sent as the page is left, which the browser completes after the page is gone. */
export function useLeavingApiClient(): LivTalesApiClient {
  return useApiClients().leaving;
}
