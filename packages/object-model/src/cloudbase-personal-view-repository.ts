import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@livtales/db";
import type {
  AccountPage,
  PageChoicesUpdate,
  ViewChoices,
} from "@livtales/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { InvalidObjectStateError } from "./errors.js";
import {
  type EventViewWrite,
  type StoredEventView,
  pageChoicesFrom,
  storedEventViewFrom,
} from "./personal-view-state.js";
import type {
  PersonalViewReadRepository,
  PersonalViewWriteRepository,
} from "./personal-views.js";

function storedView(value: unknown): StoredEventView {
  if (value === null || typeof value !== "object")
    throw new Error("CloudBase returned an invalid view.");
  const view = value as Record<string, unknown>;
  return storedEventViewFrom({
    place: view.place,
    tabs: view.tabs,
    pages: view.pages,
    layouts: view.layouts,
    choices: view.choices,
  });
}

/**
 * Personal views through the chronelle_user_event_view_* and
 * chronelle_user_page_choices_* functions. Each call is one transaction
 * that checks the account's access to the Event and writes the save field
 * by field, as the PostgreSQL repository does.
 */
export class CloudBasePersonalViewRepository
  implements PersonalViewReadRepository, PersonalViewWriteRepository
{
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async readEventView(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<StoredEventView | null> {
    const stored = await this.#rpc("chronelle_user_event_view_read", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      event_id: eventId,
    });
    return stored === null || stored === undefined ? null : storedView(stored);
  }

  async writeEventView(
    principal: UserPrincipal,
    eventId: string,
    write: EventViewWrite,
  ): Promise<StoredEventView> {
    return storedView(
      await this.#rpc("chronelle_user_event_view_save", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        event_id: eventId,
        write,
      }),
    );
  }

  async readPageChoices(
    userId: string,
    page: AccountPage,
  ): Promise<ViewChoices> {
    return pageChoicesFrom(
      await this.#rpc("chronelle_user_page_choices_read", {
        user_id: userId,
        page,
      }),
    );
  }

  async updatePageChoices(
    userId: string,
    page: AccountPage,
    changes: PageChoicesUpdate["choices"],
  ): Promise<ViewChoices> {
    return pageChoicesFrom(
      await this.#rpc("chronelle_user_page_choices_update", {
        user_id: userId,
        page,
        changes,
      }),
    );
  }

  async #rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw mapRpcError(error, {
          invalidRequest: (message) => new InvalidObjectStateError(message),
          notFound: () => new AuthorizationDeniedError(),
        });
      throw error;
    }
  }
}
