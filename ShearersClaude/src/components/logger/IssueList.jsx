// src/components/logger/IssueList.jsx
// The per-head issue editor, shared by HeadRow (table) and HeadCard (mobile).
import React from 'react';
import { ISSUE_TYPES } from '../../constants';
import Photos from './Photos';

const DEFAULT_ISSUE = { type: 'Chute', repaired: 'Not Fixed', replacementReason: '' };

export default function IssueList({ issues, onChange, photoPathPrefix, disabled }) {
  const list = issues || [];
  const setIssue = (idx, patch) => onChange(list.map((iss, i) => (i === idx ? { ...iss, ...patch } : iss)));
  const removeIssue = (idx) => onChange(list.filter((_, i) => i !== idx));
  const addIssue = () => onChange([...list, { ...DEFAULT_ISSUE }]);

  return (
    <div className="space-y-2">
      {list.map((iss, idx) => (
        <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700/50 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={iss.type}
              onChange={(e) => setIssue(idx, { type: e.target.value })}
              className="field flex-1 py-2 text-sm"
            >
              {ISSUE_TYPES.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={() => removeIssue(idx)}
              className="btn-danger !px-3 !py-2 shrink-0"
              title="Delete issue"
              aria-label="Delete issue"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {iss.type === 'WDU Replacement' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-300 whitespace-nowrap">Error was</span>
              <select
                value={iss.replacementReason || ''}
                onChange={(e) => setIssue(idx, { replacementReason: e.target.value })}
                className="field flex-1 py-2 text-sm"
              >
                <option value="">Select error…</option>
                {ISSUE_TYPES.filter((t) => t !== 'WDU Replacement').map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => setIssue(idx, { repaired: iss.repaired === 'Fixed' ? 'Not Fixed' : 'Fixed' })}
            className={
              'w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-medium transition-colors ' +
              (iss.repaired === 'Fixed' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600')
            }
          >
            {iss.repaired === 'Fixed' ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Fixed
              </>
            ) : (
              'Not Fixed'
            )}
          </button>

          {photoPathPrefix && (
            <Photos
              photos={iss.photos}
              onChange={(next) => setIssue(idx, { photos: next })}
              pathPrefix={`${photoPathPrefix}/issue-${idx + 1}`}
              disabled={disabled}
              label="Issue photo"
            />
          )}
        </div>
      ))}

      <button
        onClick={addIssue}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        Add Issue
      </button>
    </div>
  );
}
