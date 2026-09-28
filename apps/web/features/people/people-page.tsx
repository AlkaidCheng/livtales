"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { SpaceAddSeal } from "../../components/add-seal";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import {
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  UserPlusIcon,
} from "../../components/icons";
import { useQuickAddSlots } from "../../components/quick-add-row";
import {
  activePersonFilterCount,
  defaultPersonFilters,
  filterPersons,
  isPersonLayout,
  personAccountFilters,
  type PersonFilters,
  type PersonLayout,
  type PersonSort,
  personSorts,
  sortPersons,
} from "../../lib/person-collection";
import {
  useLabelsQuery,
  usePersonsQuery,
  useSessionQuery,
} from "../../lib/queries";
import { useIsPhone } from "../../lib/use-media";
import { usePersonConnections } from "../../lib/use-person-connections";
import { type StoredChoices, usePageChoices } from "../../lib/view-choices";
import { InviteFriendDialog } from "../friends/invite-friend-dialog";
import {
  PersonChips,
  PersonFilterControl,
  PersonLayoutControl,
  PersonSortControl,
} from "./person-controls";
import { PersonForm } from "./person-form";
import { PersonInspector } from "./person-inspector";
import { PersonListing } from "./person-row";

/** The People page's choices the account keeps: its layout, sort, and filters. */
type PeoplePageChoices = PersonFilters & {
  readonly layout: PersonLayout;
  readonly sort: PersonSort;
};

const defaultPeoplePageChoices: PeoplePageChoices = {
  ...defaultPersonFilters,
  layout: "list",
  sort: "name",
};

function readPeoplePageChoices(stored: StoredChoices): PeoplePageChoices {
  return {
    layout: isPersonLayout(stored.layout) ? stored.layout : "list",
    sort: personSorts.includes(stored.sort as PersonSort)
      ? (stored.sort as PersonSort)
      : "name",
    account: personAccountFilters.includes(
      stored.account as PersonFilters["account"],
    )
      ? (stored.account as PersonFilters["account"])
      : "all",
    label: typeof stored.label === "string" ? stored.label : "",
  };
}

/**
 * Everyone the workspace keeps track of, as rows or as namecards, in name
 * order unless another is chosen, narrowed by connection and label from
 * the Filter menu or the chips under the toolbar. The layout, sort, and
 * filters are kept on the account; the name query lives with the tab.
 * Invite a friend opens from the toolbar too.
 */
export function PeoplePage() {
  const t = useTranslations("people");
  const controls = useTranslations("controls");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const kept = usePageChoices(
    "people",
    defaultPeoplePageChoices,
    readPeoplePageChoices,
  );
  const { layout, sort, account, label } = kept.choices;
  const filters = useMemo(() => ({ account, label }), [account, label]);
  const setFilters = kept.change;
  const [isAdding, setIsAdding] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  const people = usePersonsQuery(true, { query: debouncedQuery });
  const labels = useLabelsQuery();
  const session = useSessionQuery();
  // On a phone the add button stands in for the header's New person.
  const phone = useIsPhone();
  const quickAdd = useQuickAddSlots();
  const me = session.data?.user.id;
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const loaded = changingQuery ? [] : (people.data?.items ?? []);
  const connections = usePersonConnections();
  const items = useMemo(
    () => sortPersons(filterPersons(loaded, filters, connections), sort),
    [loaded, filters, sort, connections],
  );
  const filtered =
    debouncedQuery !== "" || activePersonFilterCount(filters) > 0;

  const labelChoices = labels.data?.items ?? [];
  const context = {
    canEdit: true,
    connections,
    labelNames: labels.data?.names,
    me,
    onEdit: setEditingId,
  };

  if (kept.isPending)
    return (
      <main className="workspace-page">
        <LoadingState label={t("loading")} />
      </main>
    );

  return (
    <main className="workspace-page" tabIndex={-1}>
      <header className="quiet-heading collection-column">
        <h1>{t("title")}</h1>
        <div className="quiet-tools">
          <label className="inline-search">
            <SearchIcon />
            <span className="visually-hidden">{t("filterByName")}</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder={t("find")}
              type="search"
              value={query}
            />
          </label>
          <PersonFilterControl
            filters={filters}
            labels={labelChoices}
            onChange={setFilters}
          />
          <PersonSortControl
            onChange={(next) => kept.change({ sort: next })}
            sort={sort}
          />
          <PersonLayoutControl
            layout={layout}
            onChange={(next) => kept.change({ layout: next })}
          />
          <IconButton
            disabled={people.isFetching || changingQuery}
            label={t("refresh")}
            onClick={() => void people.refetch()}
          >
            <RefreshIcon />
          </IconButton>
          <IconButton
            aria-haspopup="dialog"
            label={t("invite")}
            onClick={(event) => {
              event.currentTarget.focus();
              setIsInviting(true);
            }}
          >
            <UserPlusIcon />
          </IconButton>
          {phone ? null : (
            <IconButton
              aria-haspopup="dialog"
              label={t("new")}
              onClick={(event) => {
                event.currentTarget.focus();
                setIsAdding(true);
              }}
              tone="primary"
            >
              <PlusIcon />
            </IconButton>
          )}
        </div>
      </header>
      <PersonChips
        filters={filters}
        labels={labelChoices}
        onChange={setFilters}
      />

      {isAdding ? (
        <PersonForm key="new" onCancel={() => setIsAdding(false)} />
      ) : null}
      {isInviting ? (
        <InviteFriendDialog onClose={() => setIsInviting(false)} />
      ) : null}

      <section
        aria-labelledby="people-heading"
        className="event-list-section collection-column"
      >
        <p
          aria-label={t("countLabel")}
          className="visually-hidden"
          role="status"
        >
          {people.data && !changingQuery
            ? t("count", { count: items.length })
            : ""}
        </p>
        <div className="visually-hidden">
          <h2 id="people-heading">{t("all")}</h2>
        </div>
        {people.isPending || changingQuery ? (
          <LoadingState label={t("loading")} />
        ) : null}
        {people.isError ? (
          <ErrorNotice
            error={people.error}
            isRefreshing={people.isFetching}
            onRefresh={() => void people.refetch()}
          />
        ) : null}
        {!changingQuery && people.data ? (
          <PersonListing
            context={context}
            empty={
              <>
                <span>{filtered ? t("noMatch") : t("empty")}</span>
                {filtered ? (
                  <button
                    className="link-button"
                    onClick={() => {
                      setQuery("");
                      setFilters(defaultPersonFilters);
                    }}
                    type="button"
                  >
                    {controls("clearFilters")}
                  </button>
                ) : null}
              </>
            }
            items={items}
            label={t("listLabel")}
            layout={layout}
            quickAdd={quickAdd}
          />
        ) : null}
      </section>
      {editingId ? (
        <PersonInspector
          key={editingId}
          personId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      {phone ? (
        <SpaceAddSeal label={t("new")} onAdd={() => setIsAdding(true)} />
      ) : null}
    </main>
  );
}
