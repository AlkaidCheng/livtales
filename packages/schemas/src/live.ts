import { z } from "zod";

import { eventPlanningResourceResponseSchema } from "./event-planning.js";
import { labelResponseSchema } from "./labels.js";
import { accountPageSchema } from "./personal-views.js";
import { sectionResponseSchema } from "./sections.js";

const idSchema = z.uuid();

/** Most pages one browser watches at once, across its tabs. */
export const maximumLivePages = 20;

/**
 * A page people work on together: an Event's page (`event:<id>`) or the
 * Tasks page of a space (`tasks:<space id>`).
 */
export const livePageSchema = z
  .string()
  .regex(
    /^(event|tasks):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

/**
 * Where a change sits in the order the API confirmed it, as
 * `<run>.<number>`: numbers grow within one run of the API, and a
 * position from another run cannot be resumed from.
 */
export const livePositionSchema = z.string().regex(/^[0-9a-f]{8}\.\d{1,15}$/);

/** A random id one browser tab sends with its changes, as `x-livtales-tab`. */
export const liveTabIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** The part of a page a person is on, such as an Event's tab; the web app gives it its meaning. */
export const livePlaceSchema = z.string().min(1).max(64);

/**
 * One page a browser watches: the position its data was read at (null for
 * none, which replays nothing), whether a tab shows it in front, and where
 * on it that tab is.
 */
export const liveWatchSchema = z.object({
  page: livePageSchema,
  since: livePositionSchema.nullable().default(null),
  here: z.boolean(),
  place: livePlaceSchema.nullable().default(null),
});

const liveWatchListSchema = z
  .array(liveWatchSchema)
  .max(maximumLivePages)
  .refine(
    (pages) => new Set(pages.map((entry) => entry.page)).size === pages.length,
    "Each page can appear only once.",
  );

/** The complete set of pages a stream watches; pages left out stop. */
export const liveWatchRequestSchema = z.object({
  pages: liveWatchListSchema,
});

export const liveStreamParamsSchema = z.object({
  stream: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});

/** Whether each page is watched; a page the account cannot open is not. */
export const liveWatchResponseSchema = z.object({
  pages: z.array(z.object({ page: livePageSchema, watching: z.boolean() })),
});

/** Who confirmed a change, and the tab it came from when the tab said. */
export const liveActorSchema = z.object({
  userId: idSchema,
  displayName: z.string(),
  tabId: liveTabIdSchema.nullable(),
});

/** How the objects in a change came to be as they are. */
export const liveChangeCauseSchema = z.enum([
  "created",
  "updated",
  "trashed",
  "recovered",
  "restored",
  "undone",
  "redone",
  "included",
  "excluded",
]);

const changeShape = {
  page: livePageSchema,
  actor: liveActorSchema,
  at: z.iso.datetime(),
};

/**
 * A confirmed change as one viewer of a page receives it. `objects` holds
 * the current state of each changed object the viewer may see, trashed
 * ones included; `removed` names objects that left the page for this
 * viewer.
 */
export const liveChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...changeShape,
    kind: z.literal("objects"),
    cause: liveChangeCauseSchema,
    objects: z.array(eventPlanningResourceResponseSchema),
    removed: z.array(idSchema),
  }),
  z.object({
    ...changeShape,
    kind: z.literal("sections"),
    sections: z.array(sectionResponseSchema),
    removed: z.array(idSchema),
  }),
  z.object({
    ...changeShape,
    kind: z.literal("labels"),
    labels: z.array(labelResponseSchema),
    removed: z.array(idSchema),
  }),
  z.object({
    ...changeShape,
    kind: z.literal("layout"),
    version: z.number().int().nonnegative(),
  }),
]);

/** A confirmed change with its position. */
export const liveEnvelopeSchema = z.object({
  position: livePositionSchema,
  change: liveChangeSchema,
});

/** The people on a page now, the viewer included; each named once, at the place they were last in front. */
export const livePresenceSchema = z.object({
  page: livePageSchema,
  people: z.array(
    z.object({
      userId: idSchema,
      displayName: z.string(),
      place: livePlaceSchema.nullable(),
    }),
  ),
});

/** The account's own view of an Event or page changed on another of its devices. */
export const liveViewSchema = z.object({
  target: z.union([
    z.object({ event: idSchema }),
    z.object({ page: accountPageSchema }),
  ]),
  tabId: liveTabIdSchema.nullable(),
});

/** The first message of a stream: its id, and the position it starts at. */
export const liveReadySchema = z.object({
  stream: liveStreamParamsSchema.shape.stream,
  position: livePositionSchema,
});

/**
 * Pages whose data must be read again and watched from `position`: the
 * changes since could not be replayed, or what the account may see of
 * them changed.
 */
export const liveResetSchema = z.object({
  pages: z.array(livePageSchema),
  position: livePositionSchema,
});

/** A poll from a browser that cannot hold a stream: its random id and the pages it shows. */
export const livePollRequestSchema = z.object({
  client: idSchema,
  pages: liveWatchListSchema,
});

export const livePollResponseSchema = z.object({
  position: livePositionSchema,
  changes: z.array(liveEnvelopeSchema),
  presence: z.array(livePresenceSchema),
  views: z.array(liveViewSchema),
  reset: z.array(livePageSchema),
  unavailable: z.array(livePageSchema),
});

export type LivePage = z.infer<typeof livePageSchema>;
export type LivePosition = z.infer<typeof livePositionSchema>;
export type LiveWatch = z.output<typeof liveWatchSchema>;
export type LiveWatchRequest = z.output<typeof liveWatchRequestSchema>;
export type LiveWatchResponse = z.infer<typeof liveWatchResponseSchema>;
export type LiveActor = z.infer<typeof liveActorSchema>;
export type LiveChangeCause = z.infer<typeof liveChangeCauseSchema>;
export type LiveChange = z.infer<typeof liveChangeSchema>;
export type LiveEnvelope = z.infer<typeof liveEnvelopeSchema>;
export type LivePresence = z.infer<typeof livePresenceSchema>;
export type LiveView = z.infer<typeof liveViewSchema>;
export type LiveReady = z.infer<typeof liveReadySchema>;
export type LiveReset = z.infer<typeof liveResetSchema>;
export type LivePollRequest = z.output<typeof livePollRequestSchema>;
export type LivePollResponse = z.infer<typeof livePollResponseSchema>;
