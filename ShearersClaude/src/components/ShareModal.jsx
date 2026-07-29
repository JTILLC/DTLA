// src/components/ShareModal.jsx
import React, { useState, useEffect } from 'react';
import { getDatabase, ref, set, get, remove } from 'firebase/database';
import { app } from '../firebaseConfig';

const database = getDatabase(app);
const SHARES_PATH = 'jti-downtime/shares';
const BASE_URL = 'https://jti-shearers.pages.dev';

const generateToken = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 16; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
};

export default function ShareModal({ isOpen, onClose }) {
  const [shares, setShares] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState('');
  const [error, setError] = useState('');
  const [loadingShares, setLoadingShares] = useState(true);

  const loadShares = async () => {
    setLoadingShares(true);
    try {
      const snapshot = await get(ref(database, SHARES_PATH));
      if (snapshot.exists()) {
        const data = snapshot.val();
        const list = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
        setShares(list);
      } else {
        setShares([]);
      }
    } catch (err) {
      console.error('Failed to load shares:', err);
    }
    setLoadingShares(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadShares();
    }
  }, [isOpen]);

  const generateShareLink = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const token = generateToken();
      const shareData = {
        token,
        createdAt: Date.now(),
      };
      await set(ref(database, `${SHARES_PATH}/${token}`), shareData);
      await loadShares();
    } catch (err) {
      console.error('Failed to generate share link:', err);
      setError('Failed to generate share link. Please try again.');
    }
    setIsGenerating(false);
  };

  const revokeShare = async (token) => {
    if (!window.confirm('Revoke this link? Anyone using it will lose access.')) return;
    try {
      await remove(ref(database, `${SHARES_PATH}/${token}`));
      setShares(prev => prev.filter(s => s.token !== token));
    } catch (err) {
      console.error('Failed to revoke share:', err);
      setError('Failed to revoke link. Please try again.');
    }
  };

  const copyToClipboard = async (token) => {
    const link = `${BASE_URL}/share/${token}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = link;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(''), 2000);
  };

  const handleClose = () => {
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold dark:text-gray-100">Share Links</h3>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <svg className="w-5 h-5 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Share links give read-only access to live data. Links stay active until you revoke them.
          </p>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-sm">
              {error}
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={generateShareLink}
            disabled={isGenerating}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg font-medium transition-colors"
          >
            {isGenerating ? 'Generating...' : '+ Generate New Link'}
          </button>

          {/* Active links */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Active Links ({shares.length})
            </h4>

            {loadingShares ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">Loading...</p>
            ) : shares.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">No active links yet.</p>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => {
                  const link = `${BASE_URL}/share/${share.token}`;
                  const createdDate = share.createdAt
                    ? new Date(share.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Unknown';
                  return (
                    <div
                      key={share.token}
                      className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                    >
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Created {createdDate}
                      </div>
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={link}
                          readOnly
                          className="flex-1 p-2 border dark:border-gray-600 dark:bg-gray-600 dark:text-gray-100 rounded text-xs min-w-0"
                        />
                        <button
                          onClick={() => copyToClipboard(share.token)}
                          className={`px-3 py-2 rounded text-sm font-medium whitespace-nowrap transition-colors ${
                            copiedToken === share.token
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 dark:bg-gray-500 hover:bg-gray-300 dark:hover:bg-gray-400 dark:text-gray-100'
                          }`}
                        >
                          {copiedToken === share.token ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={() => revokeShare(share.token)}
                          className="px-3 py-2 rounded text-sm font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60 whitespace-nowrap transition-colors"
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t dark:border-gray-700 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
