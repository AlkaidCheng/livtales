import type { SectionService } from "@livtales/object-model";
import {
  objectIdParamsSchema,
  sectionCreateRequestSchema,
  sectionListQuerySchema,
  sectionListResponseSchema,
  sectionResponseSchema,
  sectionUpdateRequestSchema,
} from "@livtales/schemas";
import type { FastifyInstance } from "fastify";
import { serializeSection } from "../event-planning/serialization.js";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

/**
 * The sections of an Event's To-dos and Expenses: listed by whoever may
 * view the Event, created, edited, moved, and deleted by whoever may edit
 * it. Deleting one leaves its records in the view without a section.
 */
export function registerSectionRoutes(
  app: FastifyInstance,
  dependencies: { readonly sections: SectionService },
): void {
  app.get(
    "/api/events/:id/sections",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { view } = parseRequest(sectionListQuerySchema, request.query);
      const items = await dependencies.sections.listSections(
        requirePrincipal(request),
        id,
        view,
      );
      return sectionListResponseSchema.parse({
        items: items.map(serializeSection),
      });
    },
  );
  app.post(
    "/api/events/:id/sections",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(sectionCreateRequestSchema, request.body);
      const section = sectionResponseSchema.parse(
        serializeSection(
          await dependencies.sections.createSection(
            requirePrincipal(request),
            id,
            input,
          ),
        ),
      );
      request.live.section(section);
      return reply.code(201).send(section);
    },
  );
  app.patch(
    "/api/sections/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(sectionUpdateRequestSchema, request.body);
      const section = sectionResponseSchema.parse(
        serializeSection(
          await dependencies.sections.updateSection(
            requirePrincipal(request),
            id,
            input,
          ),
        ),
      );
      request.live.section(section);
      return section;
    },
  );
  app.delete(
    "/api/sections/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const section = sectionResponseSchema.parse(
        serializeSection(
          await dependencies.sections.deleteSection(
            requirePrincipal(request),
            id,
          ),
        ),
      );
      request.live.section(section, { removed: true });
      // Grants narrowed to the section end with it.
      request.live.accessChanged({
        workspaces: [section.workspaceId],
        grantsOnly: true,
      });
      return section;
    },
  );
}
