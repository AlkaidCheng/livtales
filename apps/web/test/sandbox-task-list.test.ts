import { describe, expect, it } from "vitest";

import { SandboxStore } from "../sandbox/store";

interface TaskPage {
  readonly items: readonly { readonly id: string }[];
  readonly contexts: Readonly<Record<string, { readonly eventId: string }>>;
}

function sandbox(): SandboxStore {
  let saved: string | null = null;
  return new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
}

async function list(store: SandboxStore, query: string): Promise<TaskPage> {
  const response = await store.fetch(`/api/tasks?filter=all&limit=50${query}`);
  const body = (await response.json()) as TaskPage;
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

const ids = (page: TaskPage) => page.items.map(({ id }) => id);

describe("sandbox task list by Event", () => {
  it("keeps the tasks of no Event, of any Event, or of one, as the contexts name them", async () => {
    const store = sandbox();
    const created = await store.fetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ displayName: "Renew the passport" }),
    });
    expect(created.ok).toBe(true);
    const all = await list(store, "");
    const inEvents = ids(all).filter((id) => all.contexts[id] !== undefined);
    const standalone = ids(all).filter((id) => all.contexts[id] === undefined);
    expect(inEvents.length).toBeGreaterThan(0);
    expect(standalone.length).toBeGreaterThan(0);

    expect(ids(await list(store, "&event=any"))).toEqual(inEvents);
    expect(ids(await list(store, "&event=none"))).toEqual(standalone);
    const eventId = all.contexts[inEvents[0] ?? ""]?.eventId ?? "";
    expect(ids(await list(store, `&event=${eventId}`))).toEqual(
      inEvents.filter((id) => all.contexts[id]?.eventId === eventId),
    );
    expect(
      ids(await list(store, "&event=019d6e7d-0000-7000-8000-00000000ffff")),
    ).toEqual([]);
  });
});
