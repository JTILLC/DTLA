// src/components/logger/HeadCard.jsx
// Mobile-first card for a single head. Memoized so only the edited head re-renders.
import React from 'react';
import IssueList from './IssueList';
import { cardTint, headPropsEqual } from './headStyles';

function HeadCard({ head, date, currentLine, repeatCount, repeatTitle, onUpdateField, onOpenHistory, locked }) {
  const headIdx = head.originalIndex;
  const offline = head.offline !== 'Active';

  return (
    <div className={`p-3 rounded-xl border ${cardTint(head)}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg text-gray-900 dark:text-gray-100">Head {head.head}</span>
          {/* Status is display-only here — toggle it in the Quick Head Toggle grid
              (the old tap-to-toggle button kept getting hit instead of Add Issue) */}
          <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-xs font-semibold ' + (offline ? 'bg-red-500' : 'bg-emerald-500')}>
            <span className="w-2 h-2 rounded-full bg-white/90" />
            {offline ? 'Offline' : 'Active'}
          </span>
          <button
            onClick={() => onOpenHistory(currentLine, head.head)}
            className="inline-flex items-center gap-1 px-2 py-1 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700"
            title={`View history for Head ${head.head}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Hx
          </button>
        </div>
        {repeatCount > 0 && (
          <span className="pill bg-yellow-400 text-yellow-900 shrink-0" title={repeatTitle}>
            REPEAT ×{repeatCount}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Issues</div>
          <IssueList
            issues={head.issues}
            onChange={(newIssues) => onUpdateField(date, currentLine, headIdx, 'issues', newIssues)}
            photoPathPrefix={`downtime-photos/${date}/${currentLine}/head-${headIdx + 1}`}
            disabled={locked}
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block mb-1.5">Notes</label>
          <input
            value={head.notes || ''}
            onChange={(e) => onUpdateField(date, currentLine, headIdx, 'notes', e.target.value)}
            className="field py-2 text-sm"
            placeholder="Notes…"
          />
        </div>
      </div>
    </div>
  );
}

export default React.memo(HeadCard, headPropsEqual);
