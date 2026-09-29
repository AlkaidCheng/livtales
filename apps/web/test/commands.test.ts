import { ApiClientError } from "@livtales/api-client";
import { describe, expect, it, vi } from "vitest";

import { commandDescription, saveOnNewest } from "../lib/commands";

describe("commandDescription", () => {
  it("names a command by the fields it touched", () => {
    expect(
      commandDescription(
        { expectedVersion: 3, displayName: "Kyoto in November" },
        "Kyoto in November",
      ),
    ).toEqual({ kind: "rename", name: "Kyoto in November" });
    expect(
      commandDescription(
        { expectedVersion: 3, status: "done", completedAt: "2030-01-01" },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "complete", name: "Book the ryokan" });
    expect(
      commandDescription(
        { expectedVersion: 3, status: "todo", completedAt: null },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "reopen", name: "Book the ryokan" });
    expect(
      commandDescription({ expectedVersion: 3, rank: "b" }, "Book the ryokan"),
    ).toEqual({ kind: "move", name: "Book the ryokan" });
    expect(
      commandDescription(
        { expectedVersion: 3, dueOn: "2030-10-04" },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "edit", name: "Book the ryokan" });
  });
});

describe("saveOnNewest", () => {
  const stale = () =>
    new ApiClientError(409, "version_conflict", "Changed elsewhere");

  it("sends a save refused as stale again on the newest version", async () => {
    const send = vi
      .fn<(version: number) => Promise<string>>()
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce("saved");
    const newest = vi.fn(async () => 4);
    await expect(saveOnNewest(send, 3, newest)).resolves.toEqual({
      result: "saved",
      rebased: true,
    });
    expect(send.mock.calls).toEqual([[3], [4]]);
  });

  it("sends once when the version holds", async () => {
    const newest = vi.fn(async () => 4);
    await expect(
      saveOnNewest(async (version) => version, 3, newest),
    ).resolves.toEqual({ result: 3, rebased: false });
    expect(newest).not.toHaveBeenCalled();
  });

  it("gives up after three stale refusals and passes other errors on", async () => {
    const send = vi.fn(async () => {
      throw stale();
    });
    let version = 3;
    await expect(
      saveOnNewest(send, 3, async () => (version += 1)),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(send).toHaveBeenCalledTimes(3);
    const refused = new ApiClientError(422, "invalid_request", "Refused");
    const failing = vi.fn(async () => {
      throw refused;
    });
    await expect(saveOnNewest(failing, 3, async () => 4)).rejects.toBe(refused);
    expect(failing).toHaveBeenCalledOnce();
  });
});
