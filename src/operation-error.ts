export function operationError(error: unknown, fallback: string) {
  return error instanceof Error && error.name === "WorkspaceApiError"
    ? error.message
    : fallback;
}
