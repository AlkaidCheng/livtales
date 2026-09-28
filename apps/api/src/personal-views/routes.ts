import type { PersonalViewService } from "@livtales/object-model";
import {
  accountPageParamsSchema,
  eventViewStateSchema,
  eventViewStateUpdateSchema,
  objectIdParamsSchema,
  pageChoicesResponseSchema,
  pageChoicesUpdateSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

/**
 * Each account's own view of an Event, saved by whoever may read the
 * event's layout, and the choices it left the Events, Tasks, and People
 * pages with. An account reads and writes only its own.
 */
export function registerPersonalViewRoutes(
  app: FastifyInstance,
  dependencies: { readonly personalViews: PersonalViewService },
): void {
  app.patch(
    "/api/events/:id/view",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventViewStateUpdateSchema, request.body);
      return eventViewStateSchema.parse(
        await dependencies.personalViews.updateEventView(
          requirePrincipal(request),
          id,
          input,
        ),
      );
    },
  );
  app.get(
    "/api/account/pages/:page",
    { preHandler: app.authenticate },
    async (request) => {
      const { page } = parseRequest(accountPageParamsSchema, request.params);
      const choices = await dependencies.personalViews.getPageChoices(
        requirePrincipal(request),
        page,
      );
      return pageChoicesResponseSchema.parse({ page, choices });
    },
  );
  app.patch(
    "/api/account/pages/:page",
    { preHandler: app.authenticate },
    async (request) => {
      const { page } = parseRequest(accountPageParamsSchema, request.params);
      const input = parseRequest(pageChoicesUpdateSchema, request.body);
      const choices = await dependencies.personalViews.updatePageChoices(
        requirePrincipal(request),
        page,
        input,
      );
      return pageChoicesResponseSchema.parse({ page, choices });
    },
  );
}
