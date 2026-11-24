import React from 'react';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  renderMobileCard?: (row: T) => React.ReactNode;
  emptyState?: React.ReactNode;
  emptyMessage?: string;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  renderMobileCard,
  emptyState,
  emptyMessage,
}: TableProps<T>) {
  if (rows.length === 0 && (emptyState || emptyMessage)) {
    return emptyState ? (
      <>{emptyState}</>
    ) : (
      <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl p-8 text-center text-sm text-[#64748B] dark:text-[#94A3B8]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {renderMobileCard && (
        <div className="space-y-3 md:hidden">
          {rows.map((row) => (
            <div
              key={getRowKey(row)}
              className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl p-4"
            >
              {renderMobileCard(row)}
            </div>
          ))}
        </div>
      )}

      <div
        className={`${
          renderMobileCard ? 'hidden md:block' : 'block'
        } overflow-x-auto bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl`}
      >
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-xs font-semibold tracking-wide text-[#64748B] dark:text-[#CBD5E1] whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#24344D]">
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className="hover:bg-[#EEF3FF]/45 dark:hover:bg-[#1C2D45]/75 transition-colors"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3.5 text-sm text-[#111827] dark:text-[#F8FAFC] align-middle ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
