import React, { useState, useEffect } from 'react';
import { createShare, getSharesForCustomer, revokeShare, getAllShares, updateShareEquipmentInfo } from '../firebase/shareService';

const ShareModal = ({ isOpen, onClose, customers, diagrams, darkMode, equipmentInfo }) => {
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingShares, setExistingShares] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [updatingToken, setUpdatingToken] = useState(null); // token being updated

  // Selection state
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('all'); // 'all' or folder name

  const colors = {
    bg: darkMode ? '#1e1e1e' : '#ffffff',
    text: darkMode ? '#e0e0e0' : '#333333',
    border: darkMode ? '#444' : '#ddd',
    inputBg: darkMode ? '#2d2d2d' : '#f5f5f5',
    primary: '#2196f3',
    success: '#4caf50',
    danger: '#f44336',
    muted: darkMode ? '#888' : '#666'
  };

  // Get folders for selected customer
  const getFoldersForCustomer = (customer) => {
    if (!customer || !diagrams) return [];
    const folders = new Set();
    Object.values(diagrams).forEach(diagram => {
      if ((diagram.customer || 'General') === customer) {
        folders.add(diagram.folder || 'Uncategorized');
      }
    });
    return Array.from(folders).sort();
  };

  const folders = selectedCustomer ? getFoldersForCustomer(selectedCustomer) : [];

  // Load existing shares when modal opens
  useEffect(() => {
    if (isOpen) {
      loadExistingShares();
      // Auto-select first customer if only one
      if (customers.length === 1) {
        setSelectedCustomer(customers[0]);
      } else {
        setSelectedCustomer('');
      }
      setSelectedFolder('all');
      setShareLink('');
      setError('');
    }
  }, [isOpen, customers]);

  const loadExistingShares = async () => {
    setLoadingShares(true);
    try {
      const shares = await getAllShares();
      setExistingShares(shares);
    } catch (err) {
      console.error('Error loading shares:', err);
    }
    setLoadingShares(false);
  };

  const generateShareLink = async () => {
    if (!selectedCustomer) {
      setError('Please select a customer to share.');
      return;
    }

    setLoading(true);
    setError('');
    setCopied(false);

    try {
      const folderToShare = selectedFolder === 'all' ? null : selectedFolder;
      const share = await createShare(selectedCustomer, folderToShare, equipmentInfo);

      // Generate the link
      const baseUrl = window.location.hostname === 'localhost'
        ? `http://localhost:${window.location.port}`
        : 'https://jti-parts.pages.dev';

      const link = `${baseUrl}/view/${share.token}`;
      setShareLink(link);

      // Reload existing shares
      loadExistingShares();
    } catch (err) {
      console.error('Error generating share link:', err);
      setError('Failed to generate share link. Please try again.');
    }

    setLoading(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevokeShare = async (token) => {
    if (!window.confirm('Revoke this share link? The customer will no longer be able to access the diagrams.')) {
      return;
    }

    try {
      await revokeShare(token);

      // Clear the link if it's the current one
      if (shareLink.includes(token)) {
        setShareLink('');
      }

      // Reload shares
      loadExistingShares();
    } catch (err) {
      console.error('Error revoking share:', err);
      alert('Failed to revoke share link');
    }
  };

  const getShareUrl = (token) => {
    const baseUrl = window.location.hostname === 'localhost'
      ? `http://localhost:${window.location.port}`
      : 'https://jti-parts.pages.dev';
    return `${baseUrl}/view/${token}`;
  };

  const handleUpdateEquipmentInfo = async (token) => {
    setUpdatingToken(token);
    try {
      await updateShareEquipmentInfo(token, equipmentInfo);
      await loadExistingShares();
    } catch (err) {
      console.error('Error updating share:', err);
      alert('Failed to update equipment info.');
    }
    setUpdatingToken(null);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: colors.bg,
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '550px',
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h2 style={{ margin: 0, color: colors.text, fontSize: '20px' }}>
            🔗 Share with Customer
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: colors.muted,
              padding: '0',
              lineHeight: '1'
            }}
          >
            ×
          </button>
        </div>

        {/* Info */}
        <p style={{ color: colors.muted, marginBottom: '16px', fontSize: '14px' }}>
          Generate a shareable link that allows your customer to view their parts diagrams without signing in.
        </p>

        {/* Customer Selection */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text }}>
            Select Customer
          </label>
          <select
            value={selectedCustomer}
            onChange={(e) => {
              setSelectedCustomer(e.target.value);
              setSelectedFolder('all');
              setShareLink('');
            }}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: colors.inputBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              color: colors.text,
              fontSize: '14px'
            }}
          >
            <option value="">-- Select a customer --</option>
            {customers.map(customer => (
              <option key={customer} value={customer}>{customer}</option>
            ))}
          </select>
        </div>

        {/* Folder Selection (shown after customer is selected) */}
        {selectedCustomer && folders.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text }}>
              Share Scope
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => {
                setSelectedFolder(e.target.value);
                setShareLink('');
              }}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: colors.inputBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                color: colors.text,
                fontSize: '14px'
              }}
            >
              <option value="all">All Folders ({folders.length} folders)</option>
              {folders.map(folder => (
                <option key={folder} value={folder}>{folder}</option>
              ))}
            </select>
          </div>
        )}

        {/* Selection Summary */}
        {selectedCustomer && (
          <div style={{
            backgroundColor: colors.inputBg,
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '20px',
            border: `1px solid ${colors.border}`
          }}>
            <div style={{ color: colors.text, fontSize: '14px' }}>
              <strong>Sharing:</strong>{' '}
              <span style={{ color: colors.primary }}>
                {selectedCustomer}
                {selectedFolder !== 'all' && ` > ${selectedFolder}`}
              </span>
            </div>
            <div style={{ color: colors.muted, fontSize: '12px', marginTop: '4px' }}>
              {selectedFolder === 'all'
                ? `Customer will see all ${folders.length} folder(s)`
                : 'Customer will only see this specific folder'}
            </div>
          </div>
        )}

        {/* Equipment Info Preview */}
        {selectedCustomer && (equipmentInfo?.model || equipmentInfo?.serial || equipmentInfo?.job) && (
          <div style={{
            backgroundColor: colors.inputBg,
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: `1px solid ${colors.border}`
          }}>
            <div style={{ color: colors.muted, fontSize: '12px', marginBottom: '6px', fontWeight: 'bold' }}>
              Equipment info (from Order Info):
            </div>
            {equipmentInfo.model && <div style={{ color: colors.text, fontSize: '13px' }}><strong>Model:</strong> {equipmentInfo.model}</div>}
            {equipmentInfo.serial && <div style={{ color: colors.text, fontSize: '13px' }}><strong>Serial:</strong> {equipmentInfo.serial}</div>}
            {equipmentInfo.job && <div style={{ color: colors.text, fontSize: '13px' }}><strong>Job:</strong> {equipmentInfo.job}</div>}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            backgroundColor: 'rgba(244, 67, 54, 0.1)',
            border: '1px solid #f44336',
            color: '#f44336',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {/* Generate or Show Link */}
        {!shareLink ? (
          <button
            onClick={generateShareLink}
            disabled={loading || !selectedCustomer}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: !selectedCustomer ? '#666' : colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: !selectedCustomer ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {loading ? (
              <>⏳ Generating...</>
            ) : (
              <>🔗 Generate Share Link</>
            )}
          </button>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                value={shareLink}
                readOnly
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.inputBg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  color: colors.text,
                  fontSize: '13px'
                }}
              />
              <button
                onClick={copyToClipboard}
                style={{
                  padding: '12px 16px',
                  backgroundColor: copied ? colors.success : colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap'
                }}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <a
                href={shareLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: colors.inputBg,
                  color: colors.primary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  textDecoration: 'none',
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}
              >
                🔗 Open Link
              </a>
              <button
                onClick={() => setShareLink('')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: 'transparent',
                  color: colors.muted,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Generate New Link
              </button>
            </div>
          </div>
        )}

        {/* Existing Shares */}
        {existingShares.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ color: colors.text, fontSize: '16px', marginBottom: '12px' }}>
              Active Shares ({existingShares.length})
            </h3>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '400px',
              overflow: 'auto'
            }}>
              {existingShares.map(share => (
                <div
                  key={share.id}
                  style={{
                    padding: '12px',
                    backgroundColor: colors.inputBg,
                    borderRadius: '8px',
                    border: `1px solid ${colors.border}`
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <a
                        href={getShareUrl(share.token)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: colors.primary,
                          fontSize: '14px',
                          fontWeight: 'bold',
                          textDecoration: 'none'
                        }}
                      >
                        {share.customerName}
                        {share.folderName && <span style={{ color: colors.muted }}> &gt; {share.folderName}</span>}
                        <span style={{ fontSize: '12px', marginLeft: '6px' }}>🔗</span>
                      </a>
                      <div style={{ color: colors.muted, fontSize: '12px', marginTop: '2px' }}>
                        {share.accessCount || 0} views
                        {share.createdAt && <> • {formatDate(share.createdAt)}</>}
                        <span style={{ fontFamily: 'monospace', marginLeft: '8px' }}>...{share.token.slice(-6)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        onClick={() => handleUpdateEquipmentInfo(share.token)}
                        disabled={updatingToken === share.token}
                        title="Update this share's Model/Serial/Job with current Order Info values"
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          color: colors.primary,
                          border: `1px solid ${colors.primary}`,
                          borderRadius: '6px',
                          cursor: updatingToken === share.token ? 'not-allowed' : 'pointer',
                          fontSize: '11px',
                          opacity: updatingToken === share.token ? 0.5 : 1
                        }}
                      >
                        {updatingToken === share.token ? '...' : 'Update Info'}
                      </button>
                      <button
                        onClick={() => handleRevokeShare(share.token)}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          color: colors.danger,
                          border: `1px solid ${colors.danger}`,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '11px'
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                  {/* Show current equipment info on this share */}
                  {(share.model || share.serial || share.job) && (
                    <div style={{
                      marginTop: '6px',
                      paddingTop: '6px',
                      borderTop: `1px solid ${colors.border}`,
                      fontSize: '11px',
                      color: colors.muted,
                      display: 'flex',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}>
                      {share.model && <span><strong>Model:</strong> {share.model}</span>}
                      {share.serial && <span><strong>Serial:</strong> {share.serial}</span>}
                      {share.job && <span><strong>Job:</strong> {share.job}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {loadingShares && (
          <div style={{ textAlign: 'center', color: colors.muted, marginTop: '16px' }}>
            Loading shares...
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: '24px',
          paddingTop: '16px',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <small style={{ color: colors.muted }}>
            Customers can view diagrams and create orders
          </small>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: colors.inputBg,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
