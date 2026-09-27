import { describe, expect, it } from "vitest";
import { taskListQuerySchema } from "../src/index.js";

describe("Task collection contract", () => {
  it("keeps the tasks of no Event, of any Event, or of one Event", () => {
    const eventId = "019d6e7d-0000-7000-8000-000000000101";
    for (const event of ["none", "any", eventId])
      expect(taskListQuerySchema.parse({ event }).event).toBe(event);
    expect(taskListQuerySchema.parse({}).event).toBeUndefined();
  });

  it.each(["", "all", "standalone", "not-an-id"])(
    "refuses the Event filter %j",
    (event) => {
      expect(taskListQuerySchema.safeParse({ event }).success).toBe(false);
    },
  );
});
