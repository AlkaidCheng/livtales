import type {
  EventPlanningObjectService,
  LiveChangeReadRepository,
} from "@livtales/object-model";
import {
  livePollRequestSchema,
  livePollResponseSchema,
  liveStreamParamsSchema,
  liveTabIdSchema,
  liveWatchRequestSchema,
  liveWatchResponseSchema,
  type LiveActor,
} from "@livtales/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { HttpError, UnauthenticatedError } from "../errors.js";
import type { WorkspaceIdentityService } from "../identity/workspace-identity-service.js";
import { sessionDigest } from "../request-context.js";
import { parseRequest } from "../request-validation.js";
import { LivePageAccess } from "./live-access.js";
import { LiveAnnouncer } from "./live-announcer.js";
import {
  LiveCapacityError,
  type LiveHub,
  type LiveSink,
  type LiveViewer,
} from "./live-hub.js";
import { LiveReport } from "./live-report.js";

declare module "fastify" {
  interface FastifyRequest {
    /** What the request changed, announced once it has succeeded. */
    live: LiveReport;
  }
}

export interface LiveDependencies {
  readonly live: LiveHub;
  readonly liveReads: LiveChangeReadRepository;
  readonly identity: WorkspaceIdentityService;
  readonly objects: Pick<EventPlanningObjectService, "getEvent">;
}

function viewerOf(request: FastifyRequest): LiveViewer {
  const session = request.identitySession;
  if (session === null) throw new UnauthenticatedError();
  return { userId: session.user.id, displayName: session.user.displayName };
}

function tabOf(request: FastifyRequest): string | null {
  const parsed = liveTabIdSchema.safeParse(request.headers["x-livtales-tab"]);
  return parsed.success ? parsed.data : null;
}

class StreamClosedError extends HttpError {
  constructor() {
    super(404, "stream_closed", "The live stream is closed.");
    this.name = "StreamClosedError";
  }
}

/**
 * Live changes: the stream a browser holds open, the pages it watches on
 * it, the poll a browser without a stream uses instead, and the
 * announcement of what each successful request changed.
 */
export function registerLive(
  app: FastifyInstance,
  dependencies: LiveDependencies,
): void {
  const hub = dependencies.live;
  const access = new LivePageAccess({
    identity: dependencies.identity,
    objects: dependencies.objects,
    reads: dependencies.liveReads,
  });
  const announcer = new LiveAnnouncer(hub, dependencies.liveReads, access);
  hub.start();
  app.addHook("preClose", async () => hub.stop());

  app.decorateRequest("live", null as unknown as LiveReport);
  app.addHook("onRequest", async (request) => {
    request.live = new LiveReport();
  });
  app.addHook("onResponse", async (request, reply) => {
    const session = request.identitySession;
    if (
      request.live.notes.length === 0 ||
      reply.statusCode >= 300 ||
      session === null
    )
      return;
    const actor: LiveActor = {
      userId: session.user.id,
      displayName: session.user.displayName,
      tabId: tabOf(request),
    };
    void announcer.announce(request.live, actor).catch((error: unknown) => {
      request.log.error(
        {
          code: "live_announcement_failed",
          reason: error instanceof Error ? error.message : String(error),
        },
        "A confirmed change could not be announced",
      );
    });
  });

  app.get(
    "/api/live",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const viewer = viewerOf(request);
      const session = sessionDigest(request);
      const raw = reply.raw;
      let ended = false;
      const sink: LiveSink = {
        write: (frame) => {
          if (!ended) raw.write(frame);
        },
        get backlog() {
          return raw.writableLength;
        },
        end: () => {
          if (ended) return;
          ended = true;
          raw.end();
        },
      };
      reply.hijack();
      request.raw.socket.setNoDelay(true);
      request.raw.socket.setTimeout(0);
      raw.writeHead(200, {
        "cache-control": "private, no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });
      let stream: string;
      try {
        stream = hub.openStream(viewer, sink, session);
      } catch (error) {
        if (!(error instanceof LiveCapacityError)) throw error;
        // The client reconnects after the retry interval the frame sets.
        sink.write("retry: 30000\n\n");
        sink.end();
        return;
      }
      raw.on("close", () => {
        ended = true;
        hub.closeStream(stream);
      });
    },
  );

  app.put(
    "/api/live/streams/:stream",
    { preHandler: app.authenticate },
    async (request) => {
      const { stream } = parseRequest(liveStreamParamsSchema, request.params);
      const { pages } = parseRequest(liveWatchRequestSchema, request.body);
      const viewer = viewerOf(request);
      const watched = hub.watchedPages(stream, viewer.userId);
      if (watched === undefined) throw new StreamClosedError();
      const entries = await Promise.all(
        pages.map(async (entry) => ({
          ...entry,
          access:
            watched.get(entry.page) ??
            (await access.resolve(viewer.userId, entry.page)),
        })),
      );
      hub.watch(stream, entries);
      return liveWatchResponseSchema.parse({
        pages: entries.map((entry) => ({
          page: entry.page,
          watching: entry.access !== null,
        })),
      });
    },
  );

  app.post(
    "/api/live/poll",
    { preHandler: app.authenticate },
    async (request) => {
      const { client, pages } = parseRequest(
        livePollRequestSchema,
        request.body,
      );
      const viewer = viewerOf(request);
      const entries = await Promise.all(
        pages.map(async (entry) => ({
          ...entry,
          access: await access.resolve(viewer.userId, entry.page),
        })),
      );
      return livePollResponseSchema.parse(hub.poll(viewer, client, entries));
    },
  );
}
