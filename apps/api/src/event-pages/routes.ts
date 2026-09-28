import type {
  EventLayoutService,
  PersonalViewService,
} from "@livtales/object-model";
import {
  eventLayoutQuerySchema,
  eventLayoutResponseSchema,
  eventLayoutUpdateSchema,
  eventLayoutWithViewResponseSchema,
  eventLayoutHistoryQuerySchema,
  eventLayoutHistoryResponseSchema,
  eventLayoutRestoreSchema,
  objectIdParamsSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerEventPageRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly eventLayouts: EventLayoutService;
    readonly personalViews: PersonalViewService;
  },
): void {
  app.get(
    "/api/events/:id/layout/history",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventLayoutHistoryQuerySchema, request.query);
      return eventLayoutHistoryResponseSchema.parse(
        await dependencies.eventLayouts.history(
          requirePrincipal(request),
          id,
          input,
        ),
      );
    },
  );
  app.post(
    "/api/events/:id/layout/restore",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventLayoutRestoreSchema, request.body);
      const principal = requirePrincipal(request);
      const layout = eventLayoutResponseSchema.parse(
        await dependencies.eventLayouts.restore(
          { principal, requestId: request.id },
          id,
          input,
        ),
      );
      request.live.layout(principal.workspaceId, id, layout.version);
      return layout;
    },
  );
  // `include=yours` adds the account's own view; without it the response
  // is the layout alone, as clients that validate it strictly expect.
  app.get(
    "/api/events/:id/layout",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { include } = parseRequest(eventLayoutQuerySchema, request.query);
      const principal = requirePrincipal(request);
      if (include === "yours")
        return eventLayoutWithViewResponseSchema.parse(
          await dependencies.personalViews.getEventLayoutWithView(
            principal,
            id,
          ),
        );
      return eventLayoutResponseSchema.parse(
        await dependencies.eventLayouts.get(principal, id),
      );
    },
  );
  app.patch(
    "/api/events/:id/layout",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventLayoutUpdateSchema, request.body);
      const principal = requirePrincipal(request);
      const layout = eventLayoutResponseSchema.parse(
        await dependencies.eventLayouts.update(
          { principal, requestId: request.id },
          id,
          input,
        ),
      );
      request.live.layout(principal.workspaceId, id, layout.version);
      return layout;
    },
  );
}
