// Pure workflow gates shared by the accounting action handlers and focused Node tests.
// Keep these decisions separate from UI state so the server remains authoritative.
export function isPreparationParticipant(staffId, preparedBy, lastPreparedBy) {
  return Boolean(staffId && [preparedBy, lastPreparedBy].includes(staffId));
}

// A corrected opening workbook updates the existing unposted Excel journal in place.
// It must never create a second opening journal for a returned/rejected source.
export function openingImportDecision(journal) {
  if (!journal) return { action: "create" };
  if (journal.status === "Submitted") {
    return {
      action: "reject",
      message: "The opening balance entry is waiting for independent review. Ask the reviewer to return it, then upload the corrected TB.",
    };
  }
  if (journal.status === "Posted") {
    return {
      action: "reject",
      message: "The opening balance entry is already posted. Posted opening corrections require a reviewed adjustment.",
    };
  }
  if (journal.source_snapshot?.kind !== "Excel") {
    return {
      action: "reject",
      message: "An opening balance entry already exists for this financial year. Open it from Entry register and edit the draft there.",
    };
  }
  return { action: "replace" };
}
