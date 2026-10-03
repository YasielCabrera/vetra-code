import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import {
  reconcileTicketBoardSearch,
  ticketBoardPreferencesFromSearch,
  type TicketBoardCatalog,
  type TicketBoardSearch,
} from "./ticketBoard.logic";

const STORAGE_KEY = "vetra:ticket-board-preferences:v1";
const StoredSearch = Schema.Record(Schema.String, Schema.Unknown);

export function readTicketBoardPreferences(): TicketBoardSearch {
  try {
    return ticketBoardPreferencesFromSearch(getLocalStorageItem(STORAGE_KEY, StoredSearch));
  } catch (error) {
    console.error("Could not read Tickets preferences.", error);
    return {};
  }
}

export function rememberTicketBoardSearch(search: TicketBoardSearch): void {
  try {
    setLocalStorageItem(STORAGE_KEY, ticketBoardPreferencesFromSearch(search), StoredSearch);
  } catch (error) {
    console.error("Could not save Tickets preferences.", error);
  }
}

/**
 * Drops remembered selections the catalog rejected. An explicit URL is not an input:
 * opening `/tickets?view=list` must not replace the rest of what this client saved.
 */
export function persistReconciledTicketBoardPreferences(catalogs: TicketBoardCatalog): void {
  const remembered = readTicketBoardPreferences();
  const pruned = reconcileTicketBoardSearch(remembered, catalogs);
  if (pruned !== remembered) rememberTicketBoardSearch(pruned);
}
