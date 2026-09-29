// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { ExpenseForm } from "../features/events/expense-form";
import { ReminderForm } from "../features/events/reminder-form";
import { TaskForm } from "../features/events/task-form";

import { EventInspector } from "../features/events/event-inspector";
import { CreateScheduleDialog } from "../features/events/create-schedule-dialog";
import { formatDateTime, fromDateTimeInput } from "../lib/format";
import { dateRow, setDates, setRowDate, setTimes } from "./date-rows";
import { withCommands } from "./helpers/command-fetch";

const objectId = "019d6e7d-0000-7000-8000-000000000010";
const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const common = {
  id: objectId,
  workspaceId,
  permissionScopeId: objectId,
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
};
const eventResource = (version: number, displayName: string) => ({
  ...common,
  version,
  displayName,
  objectType: "event" as const,
  startsAt: "2026-10-15T17:00:00.000Z",
  endsAt: null,
  timezone: "UTC",
  startsOn: null,
  endsOn: null,
  isAllDay: false,
  location: null,
  description: null,
});

const taskResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "task",
    status: "todo",
    dueOn: null,
    dueAt: null,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    description: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    rank: "00000001000",
    labelIds: [] as string[],
    sectionId: null,
  }) as const;

const expenseResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "expense",
    amount: "25.0000",
    currency: "USD",
    occurredAt: "2026-09-02T20:00:00.000Z",
    sectionId: null,
  }) as const;

const reminderResource = (version: number, displayName: string) =>
  ({
    ...common,
    version,
    displayName,
    objectType: "reminder",
    status: "pending",
    remindAt: "2026-10-15T16:00:00.000Z",
    rank: "00000001000",
  }) as const;

const forms = [
  {
    name: "event",
    resource: eventResource,
    field: "Name",
    render: (version: number, displayName: string) => (
      <EventInspector
        onClose={() => {}}
        event={eventResource(version, displayName)}
      />
    ),
  },
  {
    name: "task",
    resource: taskResource,
    field: "Task",
    render: (version: number, displayName: string) => (
      <TaskForm eventId={objectId} task={taskResource(version, displayName)} />
    ),
  },
  {
    name: "expense",
    resource: expenseResource,
    field: "Expense",
    render: (version: number, displayName: string) => (
      <ExpenseForm
        eventId={objectId}
        expense={expenseResource(version, displayName)}
      />
    ),
  },
  {
    name: "reminder",
    resource: reminderResource,
    field: "Reminder",
    render: (version: number, displayName: string) => (
      <ReminderForm
        eventId={objectId}
        reminder={reminderResource(version, displayName)}
      />
    ),
  },
];

describe("versioned editor drafts", () => {
  beforeEach(() => {
    for (const method of ["showModal", "close"] as const) {
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.toggleAttribute("open", method === "showModal");
        },
      });
    }
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it.each(["event", "schedule"])(
    "clears %s validation when the times are cleared",
    async (kind) => {
      const user = userEvent.setup();
      const event = { ...eventResource(1, "Plan"), startsAt: null };
      const view = render(
        kind === "event" ? (
          <EventInspector onClose={() => {}} event={event} />
        ) : (
          <CreateScheduleDialog eventId={objectId} onClose={() => {}} />
        ),
        { wrapper: Providers },
      );
      // A span with only a start time asks for the end's time too.
      await setDates(user, "2030-07-03", "2030-07-05");
      await setTimes(user, "09:00");
      const form = view.container.querySelector("form");
      if (form === null) throw new Error("Editor form not found.");
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Provide both an end date and time, or leave both empty.",
      );
      await user.click(screen.getByRole("button", { name: "Clear times" }));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("clears a recorded expense while keeping its currency and date for another entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const { resource } = JSON.parse(String(init?.body)) as {
          resource: {
            displayName: string;
            amount: string;
            currency: string;
            occurredAt: string;
          };
        };
        return Response.json({
          resource: {
            ...expenseResource(1, resource.displayName),
            ...resource,
          },
          relationId: "019d6e7d-0000-7000-8000-000000000020",
        });
      }),
    );
    const user = userEvent.setup();
    render(<ExpenseForm eventId={objectId} />, { wrapper: Providers });
    fireEvent.change(screen.getByLabelText("Expense"), {
      target: { value: "Venue" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "12.3400" },
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "EUR" },
    });
    await setRowDate(
      user,
      /^(Set the day it was paid|Paid on)/,
      "2026-10-15",
      "10:00",
    );
    const paidOn = formatDateTime(fromDateTimeInput("2026-10-15T10:00"));
    expect(dateRow(/^Paid on/)).toHaveTextContent(paidOn);
    await user.click(screen.getByRole("button", { name: "Record expense" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Expense")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
    expect(dateRow(/^Paid on/)).toHaveTextContent(paidOn);
    expect(
      screen.getByRole("button", { name: "Record expense" }),
    ).toBeEnabled();
  });

  it.each(forms)(
    "moves the $name draft onto a newer version, keeping what was typed",
    async (form) => {
      const bodies: Record<string, unknown>[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          displayName: string;
          expectedVersion: number;
        };
        bodies.push(body);
        return Response.json(
          form.resource(body.expectedVersion + 1, body.displayName),
        );
      });
      vi.stubGlobal("fetch", withCommands(fetch));
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial title"), {
        wrapper: Providers,
      });
      // An untouched field follows the newer version.
      view.rerender(form.render(2, "Collaborator update"));
      expect(screen.getByLabelText(form.field)).toHaveValue(
        "Collaborator update",
      );
      fireEvent.change(screen.getByLabelText(form.field), {
        target: { value: "My unsaved draft" },
      });
      // A field the person changed keeps their value.
      view.rerender(form.render(3, "Another update"));
      expect(screen.getByLabelText(form.field)).toHaveValue("My unsaved draft");
      expect(screen.queryByRole("alert")).toBeNull();
      const submit = view.container.querySelector("button[type=submit]");
      if (submit === null) throw new Error("Submit button not found.");
      await user.click(submit);
      await waitFor(() => expect(bodies).toHaveLength(1));
      // Only the changed field is sent, over the newest version.
      expect(bodies[0]).toEqual({
        displayName: "My unsaved draft",
        expectedVersion: 3,
      });
    },
  );

  it.each(forms)(
    "disables $name inputs and duplicate submissions while saving",
    async (editor) => {
      let finishSave: ((response: Response) => void) | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(
        () =>
          new Promise<Response>((resolve) => {
            finishSave = resolve;
          }),
      );
      vi.stubGlobal("fetch", withCommands(fetch));
      const user = userEvent.setup();
      const view = render(editor.render(1, "Initial"), { wrapper: Providers });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      fireEvent.change(screen.getByLabelText(editor.field), {
        target: { value: "Renamed" },
      });
      screen.getByLabelText(editor.field).focus();
      await user.keyboard("{Control>}{Enter}{/Control}");
      for (const input of view.container.querySelectorAll("input"))
        expect(input).toBeDisabled();
      const form = view.container.querySelector("form");
      if (form === null || finishSave === undefined)
        throw new Error("Save was not started.");
      fireEvent.submit(form);
      fireEvent.keyDown(screen.getByLabelText(editor.field), {
        key: "Enter",
        ctrlKey: true,
      });
      expect(
        fetch.mock.calls.filter(
          ([, init]) => (init?.method ?? "GET") !== "GET",
        ),
      ).toHaveLength(1);
      expect(form).toHaveAttribute("aria-busy", "true");
      expect(
        screen.getByRole("status", { name: "Save status" }),
      ).toHaveTextContent("Saving changes...");
      await act(() =>
        finishSave?.(
          Response.json(
            { error: { code: "invalid_request", message: "Refused" } },
            { status: 422 },
          ),
        ),
      );
      await waitFor(() =>
        expect(screen.getByLabelText(editor.field)).toBeEnabled(),
      );
      expect(form).toHaveAttribute("aria-busy", "false");
    },
  );

  it.each(forms)(
    "sends a $name save refused as stale again on the newest version",
    async (form) => {
      // The record moves on to version 2 before the save arrives.
      const server = { version: 2, displayName: "Initial" };
      const writes: { expectedVersion: number }[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if ((init?.method ?? "GET") === "GET") {
          if (!String(input).endsWith(`/${objectId}`))
            return Response.json(
              { error: { code: "not_found", message: "Not found" } },
              { status: 404 },
            );
          return Response.json(
            form.resource(server.version, server.displayName),
          );
        }
        const body = JSON.parse(String(init?.body)) as {
          displayName: string;
          expectedVersion: number;
        };
        writes.push(body);
        if (body.expectedVersion !== server.version)
          return Response.json(
            {
              error: {
                code: "version_conflict",
                message: "This object was updated by another request.",
              },
            },
            { status: 409 },
          );
        server.version += 1;
        server.displayName = body.displayName;
        return Response.json(form.resource(server.version, body.displayName));
      });
      vi.stubGlobal("fetch", withCommands(fetch));
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial"), { wrapper: Providers });
      fireEvent.change(screen.getByLabelText(form.field), {
        target: { value: "My draft" },
      });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      await user.click(submit);
      await waitFor(() =>
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toHaveTextContent("Saved successfully."),
      );
      expect(writes.map((write) => write.expectedVersion)).toEqual([1, 2]);
      expect(server).toEqual({ version: 3, displayName: "My draft" });
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each(forms)(
    "keeps the $name draft when the newest version keeps moving",
    async (form) => {
      let version = 1;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        // Every write arrives one version late.
        version += 1;
        if ((init?.method ?? "GET") === "GET")
          return String(input).endsWith(`/${objectId}`)
            ? Response.json(form.resource(version, "Initial"))
            : Response.json(
                { error: { code: "not_found", message: "Not found" } },
                { status: 404 },
              );
        return Response.json(
          {
            error: {
              code: "version_conflict",
              message: "This object was updated by another request.",
            },
          },
          { status: 409 },
        );
      });
      vi.stubGlobal("fetch", withCommands(fetch));
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial"), { wrapper: Providers });
      fireEvent.change(screen.getByLabelText(form.field), {
        target: { value: "My draft" },
      });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      await user.click(submit);
      expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
        "A newer version is available",
      );
      expect(
        fetch.mock.calls.filter(
          ([, init]) => init?.method !== undefined && init.method !== "GET",
        ),
      ).toHaveLength(3);
      expect(screen.getByLabelText(form.field)).toHaveValue("My draft");
      expect(submit).toBeEnabled();
    },
  );

  it.each(
    forms.flatMap((form) =>
      ["button", "shortcut"].map((method) => ({ ...form, method })),
    ),
  )(
    "uses the accepted $name save version through $method without a parent rerender",
    async (form) => {
      const versions: number[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          displayName: string;
          expectedVersion: number;
        };
        versions.push(body.expectedVersion);
        return Response.json(
          form.resource(body.expectedVersion + 1, body.displayName),
        );
      });
      vi.stubGlobal("fetch", withCommands(fetch));
      const user = userEvent.setup();
      const view = render(form.render(1, "Initial"), {
        wrapper: Providers,
      });
      const submit = view.container.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      );
      if (submit === null) throw new Error("Submit button not found.");
      for (const title of ["First edit", "Second edit"]) {
        fireEvent.change(screen.getByLabelText(form.field), {
          target: { value: title },
        });
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toBeEmptyDOMElement();
        if (form.method === "button") await user.click(submit);
        else {
          screen.getByLabelText(form.field).focus();
          await user.keyboard("{Meta>}{Enter}{/Meta}");
        }
        await waitFor(() => expect(submit).toBeEnabled());
        expect(
          screen.getByRole("status", { name: "Save status" }),
        ).toHaveTextContent("Saved successfully.");
      }
      expect(versions).toEqual([1, 2]);
    },
  );
});
