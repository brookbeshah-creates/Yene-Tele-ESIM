import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="border-b border-[#E5E7EB] dark:border-[#24344D] flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
              isActive
                ? 'border-[#0A2DB8] dark:border-[#3B82F6] text-[#0A2DB8] dark:text-[#60A5FA]'
                : 'border-transparent text-[#64748B] dark:text-[#CBD5E1] hover:text-[#111827] dark:hover:text-[#F8FAFC]'
            }`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={`ml-2 px-1.5 py-0.5 text-xs rounded-md tabular-nums ${
                  isActive
                    ? 'bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#93C5FD]'
                    : 'bg-[#F8FAFC] dark:bg-[#1C2D45] text-[#64748B] dark:text-[#CBD5E1]'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
