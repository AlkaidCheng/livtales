import { z } from "zod";

import { eventTabsPreferenceSchema } from "./authentication.js";
import {
  eventComponentViewSchema,
  eventLayoutResponseSchema,
} from "./event-pages.js";

const choiceNameSchema = z.string().min(1).max(40);
const choiceTextSchema = z.string().max(200);

/**
 * One choice's value: a word or number, a switch, a list of words, or a
 * small map of words to switches or words (such as the headings folded on
 * one of the Events lists).
 */
const choiceValueSchema = z.union([
  choiceTextSchema,
  z.number().finite(),
  z.boolean(),
  z.array(choiceTextSchema).max(200),
  z.record(z.string().min(1).max(80), z.union([z.boolean(), choiceTextSchema])),
]);

/** The most a set of choices takes once written as JSON. */
export const viewChoicesByteLimit = 16_384;

/**
 * The choices one component or page was left with, by name: its layout,
 * what it shows, its sort and its filters. Only choices that differ from
 * the defaults are kept; the web app gives each name its meaning, so a
 * name it does not know is kept and ignored.
 */
export const viewChoicesSchema = z
  .record(choiceNameSchema, choiceValueSchema)
  .refine((choices) => Object.keys(choices).length <= 40, {
    message: "A component keeps up to 40 choices.",
  })
  .refine(
    (choices) =>
      new TextEncoder().encode(JSON.stringify(choices)).length <=
      viewChoicesByteLimit,
    { message: "A component's choices take up to 16 KB." },
  );

/** A tab's view key ("todos") or a page component's id. */
const componentKeySchema = z.string().min(1).max(40);

/** Where the account left an event: one of its views, or one of its pages. */
export const eventPlaceSchema = z.union([
  z.strictObject({ view: z.string().min(1).max(40) }),
  z.strictObject({ page: z.uuid() }),
]);

/**
 * The account's own view of one event. The first save keeps a copy of the
 * event's page order and of each page component's layout, which later
 * changes to the event's defaults never reach; pages and components added
 * since join the copy when the view is next read or saved, and those
 * removed drop out. `stored` is false until that first save, and the view
 * then shows what the first save would keep.
 */
export const eventViewStateSchema = z.strictObject({
  stored: z.boolean(),
  /** Where the event was left; null opens it on its Overview. */
  place: eventPlaceSchema.nullable(),
  /** The strip's views in order, and the views and pages it leaves out. */
  tabs: eventTabsPreferenceSchema,
  /** Every page of the event, in the account's order. */
  pages: z.array(z.uuid()).max(20),
  /** Each page component's layout for the account; null is its kind's default. */
  layouts: z.record(z.uuid(), eventComponentViewSchema.nullable()),
  /** The choices of each tab (by view key) and page component (by id) that differ from the defaults. */
  choices: z.record(componentKeySchema, viewChoicesSchema),
});

/**
 * A change to the account's view of an event. `place`, `tabs`, and `pages`
 * replace what is kept; `layouts` sets the named components' layouts; each
 * entry of `choices` replaces that component's choices, and null or an
 * empty object returns it to its defaults. Page ids and component ids that
 * are not on the event are ignored.
 */
export const eventViewStateUpdateSchema = z.strictObject({
  place: eventPlaceSchema.optional(),
  tabs: eventTabsPreferenceSchema.optional(),
  pages: z.array(z.uuid()).max(20).optional(),
  layouts: z.record(z.uuid(), eventComponentViewSchema.nullable()).optional(),
  choices: z
    .record(componentKeySchema, viewChoicesSchema.nullable())
    .optional(),
});

/** `include=yours` adds the account's own view to the event's layout. */
export const eventLayoutQuerySchema = z.object({
  include: z.literal("yours").optional(),
});

/** The event's layout with the account's own view of it. */
export const eventLayoutWithViewResponseSchema =
  eventLayoutResponseSchema.extend({ yours: eventViewStateSchema });

/** The collection pages whose choices the account keeps. */
export const accountPageSchema = z.enum(["events", "tasks", "people"]);

export const accountPageParamsSchema = z.strictObject({
  page: accountPageSchema,
});

/** A collection page's choices as the account left them. */
export const pageChoicesResponseSchema = z.strictObject({
  page: accountPageSchema,
  choices: viewChoicesSchema,
});

/**
 * A change to a collection page's choices, merged by name: a value
 * replaces that choice and null returns it to its default.
 */
export const pageChoicesUpdateSchema = z.strictObject({
  choices: z.record(choiceNameSchema, choiceValueSchema.nullable()),
});

export type ViewChoices = z.infer<typeof viewChoicesSchema>;
export type EventPlace = z.infer<typeof eventPlaceSchema>;
export type EventViewState = z.infer<typeof eventViewStateSchema>;
export type EventViewStateUpdate = z.infer<typeof eventViewStateUpdateSchema>;
export type EventLayoutQuery = z.infer<typeof eventLayoutQuerySchema>;
export type EventLayoutWithViewResponse = z.infer<
  typeof eventLayoutWithViewResponseSchema
>;
export type AccountPage = z.infer<typeof accountPageSchema>;
export type PageChoicesResponse = z.infer<typeof pageChoicesResponseSchema>;
export type PageChoicesUpdate = z.infer<typeof pageChoicesUpdateSchema>;
