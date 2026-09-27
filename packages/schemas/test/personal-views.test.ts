import { describe, expect, it } from "vitest";
import {
  eventLayoutQuerySchema,
  eventLayoutWithViewResponseSchema,
  eventViewStateUpdateSchema,
  pageChoicesUpdateSchema,
  viewChoicesSchema,
} from "../src/index.js";

const eventId = "019d6e7d-0000-7000-8000-000000000101";
const pageId = "019d6e7d-0000-7000-8000-000000000201";
const componentId = "019d6e7d-0000-7000-8000-000000000301";

describe("personal view contract", () => {
  it("returns the layout with the account's own view", () => {
    const response = eventLayoutWithViewResponseSchema.parse({
      eventId,
      version: 3,
      updatedAt: null,
      pages: [
        {
          id: pageId,
          name: "Plan",
          components: [{ id: componentId, kind: "todos", view: "by-day" }],
        },
      ],
      yours: {
        stored: true,
        place: { page: pageId },
        tabs: { order: ["overview", "todos"], hidden: ["sharing"] },
        pages: [pageId],
        layouts: { [componentId]: "list" },
        choices: {
          todos: { show: "all", sort: "due", overdue: true },
          [componentId]: { assignee: "me" },
        },
      },
    });
    expect(response.yours.layouts[componentId]).toBe("list");
    expect(eventLayoutQuerySchema.parse({ include: "yours" }).include).toBe(
      "yours",
    );
    expect(eventLayoutQuerySchema.parse({}).include).toBeUndefined();
  });

  it("keeps a view or a page as the place, never both", () => {
    expect(
      eventViewStateUpdateSchema.safeParse({ place: { view: "calendar" } })
        .success,
    ).toBe(true);
    expect(
      eventViewStateUpdateSchema.safeParse({
        place: { view: "calendar", page: pageId },
      }).success,
    ).toBe(false);
    expect(
      eventViewStateUpdateSchema.safeParse({ place: { page: "not-an-id" } })
        .success,
    ).toBe(false);
  });

  it("clears a component's choices with null and refuses unknown keys", () => {
    expect(
      eventViewStateUpdateSchema.parse({ choices: { todos: null } }).choices,
    ).toEqual({ todos: null });
    expect(eventViewStateUpdateSchema.safeParse({ stored: true }).success).toBe(
      false,
    );
  });

  it("takes words, numbers, switches, lists, and small maps as choices", () => {
    expect(
      viewChoicesSchema.parse({
        layout: "list",
        limit: 20,
        overdue: false,
        labels: ["a", "b"],
        "folds.past": { "2025": true, "2025-10": false },
      }),
    ).toBeTruthy();
    expect(
      viewChoicesSchema.safeParse({ nested: { a: { b: 1 } } }).success,
    ).toBe(false);
  });

  it("bounds a component's choices", () => {
    const many = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [`c${index}`, true]),
    );
    expect(viewChoicesSchema.safeParse(many).success).toBe(false);
    const large = { list: Array.from({ length: 200 }, () => "x".repeat(200)) };
    expect(viewChoicesSchema.safeParse(large).success).toBe(false);
  });

  it("merges a page's choices by name, null returning one to its default", () => {
    expect(
      pageChoicesUpdateSchema.parse({ choices: { layout: "list", sort: null } })
        .choices,
    ).toEqual({ layout: "list", sort: null });
    expect(
      pageChoicesUpdateSchema.safeParse({ page: "events", choices: {} })
        .success,
    ).toBe(false);
  });
});
