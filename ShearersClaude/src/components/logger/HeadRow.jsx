// src/components/logger/HeadRow.jsx
// Desktop table row for a single head. Memoized so only the edited head re-renders.
import React from 'react';
import IssueList from './IssueList';
import { rowTint, headPropsEqual } from './headStyles';

const cell = 'px-3 py-2 align-top border-b border-gray-200/70 dark:border-gray-700';

function HeadRow({ head, date, currentLine, repeatCount, repeatTitle, onUpdateField, onOpenHistory , locked}) {
  const headIdx = head.originalIndex;
  const offline = head.offline !== 'Active';

  return (
    <tr className={rowTint(head)}>
      <td className={`${cell} font-semibold text-gray-900 dark:text-gray-100`}>
        <div className="flex flex-col items-start gap-1">
          <span>{head.head}</span>
          <button
            onClick={() => onOpenHistory(currentLine, head.head)}
            className="inline-flex items-center px-2 py-1 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700"
            title={`View history for Head ${head.head}`}
          >
            Hx
          </button>
          {repeatCount > 0 && (
            <span className="pill bg-yellow-400 text-yellow-900" title={repeatTitle}>×{repeatCount}</span>
          )}
        </div>
      </td>
      <td className={cell}>
        {/* Display-only — toggle status in the Quick Head Toggle grid */}
        <span
          className={
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium ' +
            (offline ? 'bg-red-500' : 'bg-emerald-500')
          }
        >
          <span className="w-2 h-2 rounded-full bg-white/90" />
          {offline ? 'Offline' : 'Active'}
        </span>
      </td>
      <td className={`${cell} min-w-[260px]`}>
        <IssueList
          issues={head.issues}
          onChange={(newIssues) => onUpdateField(date, currentLine, headIdx, 'issues', newIssues)}
          photoPathPrefix={`downtime-photos/${date}/${currentLine}/head-${headIdx + 1}`}
          disabled={locked}
        />
      </td>
      <td className={cell}>
        <input
          value={head.notes || ''}
          onChange={(e) => onUpdateField(date, currentLine, headIdx, 'notes', e.target.value)}
          className="field py-2 text-sm min-w-[140px]"
          placeholder="Notes…"
        />
      </td>
    </tr>
  );
}

export default React.memo(HeadRow, headPropsEqual);
