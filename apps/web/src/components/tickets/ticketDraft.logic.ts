/**
 * `/tickets/new` prefill. Links name ids inside `env`, the environment the ticket is created in;
 * without `env` the form starts on the primary environment and ignores them.
 */
export interface NewTicketSearch {
  readonly env?: string;
  readonly title?: string;
  readonly body?: string;
  readonly project?: string;
  readonly thread?: string;
}

function searchText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.slice(0, maxLength)
    : undefined;
}

export function validateNewTicketSearch(raw: Record<string, unknown>): NewTicketSearch {
  const env = searchText(raw.env, 200);
  const title = searchText(raw.title, 500);
  const body = searchText(raw.body, 20_000);
  const project = searchText(raw.project, 200);
  const thread = searchText(raw.thread, 200);
  return {
    ...(env === undefined ? {} : { env }),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(project === undefined ? {} : { project }),
    ...(thread === undefined ? {} : { thread }),
  };
}

export function addTicketLabel(
  labels: ReadonlyArray<string>,
  typed: string,
): ReadonlyArray<string> {
  const label = typed.trim().slice(0, 100);
  if (label.length === 0 || labels.some((existing) => existing === label)) return labels;
  return [...labels, label];
}
