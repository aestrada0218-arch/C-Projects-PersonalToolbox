import "./pagination.css";
import { useState } from "react";
export type PageSize = 25 | 50;
export function paginate<T>(items: readonly T[], page: number, size: PageSize) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.max(1, Math.min(page, pages));
  const start = (current - 1) * size;
  return {
    visible: items.slice(start, start + size),
    current,
    pages,
    total: items.length,
    first: items.length ? start + 1 : 0,
    last: Math.min(start + size, items.length),
  };
}
export function usePagination<T>(items: readonly T[], resetKey: string) {
  const [state, setState] = useState({
    page: 1,
    size: 25 as PageSize,
    key: resetKey,
  });
  // Reset immediately on every filter transition, including returning to an older query.
  if (state.key !== resetKey) setState({ ...state, page: 1, key: resetKey });
  const result = paginate(
    items,
    state.key === resetKey ? state.page : 1,
    state.size,
  );
  return {
    ...result,
    size: state.size,
    setPage: (page: number) => setState((s) => ({ ...s, page, key: resetKey })),
    setSize: (size: PageSize) => setState({ page: 1, size, key: resetKey }),
  };
}
export type PaginationState = ReturnType<typeof usePagination>;
export function Pagination({
  value,
  label,
}: {
  value: PaginationState;
  label: string;
}) {
  return (
    <div className="pagination-controls" aria-label={`${label} pagination`}>
      <label>
        Rows per page{" "}
        <select
          aria-label={`${label} rows per page`}
          value={value.size}
          onChange={(e) => value.setSize(e.target.value === "50" ? 50 : 25)}
        >
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
      </label>
      <span>
        {value.first}–{value.last} of {value.total}
      </span>
      <div className="expense-pagination">
        <button
          aria-label={`Previous ${label} page`}
          disabled={value.current <= 1}
          onClick={() => value.setPage(value.current - 1)}
        >
          Previous
        </button>
        <span aria-live="polite">
          {value.current} / {value.pages}
        </span>
        <button
          aria-label={`Next ${label} page`}
          disabled={value.current >= value.pages}
          onClick={() => value.setPage(value.current + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
