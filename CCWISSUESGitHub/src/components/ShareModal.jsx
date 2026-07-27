import { useState, useEffect } from 'react';
import { Copy, Check, Link, ExternalLink, Trash2, X } from 'lucide-react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

const ShareModal = ({
  isOpen,
  onClose,
  customerId,
  customerName,
  visitId,
  visitName,
  userId
}) => {
  const toast = useToast();
  const dialog = useDialog();
  useBodyScrollLock(isOpen);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedShareId, setCopiedShareId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingShares, setExistingShares] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [allShares, setAllShares] = useState([]);
  const [loadingAllShares, setLoadingAllShares] = useState(false);
  const [showAllLinks, setShowAllLinks] = useState(false);
  // Share-link lifetime in days; '' means never expires.
  const [expiryDays, setExpiryDays] = useState('90');

  // Build share URL from token
  const getShareUrl = (token) => {
    const baseUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:5174'
      : 'https://jti-ccw-viewer.pages.dev';
    return `${baseUrl}/view/${token}`;
  };

  // Copy any share URL to clipboard
  const copyShareUrl = async (token, shareId) => {
    const url = getShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setCopiedShareId(shareId);
    setTimeout(() => setCopiedShareId(null), 2000);
  };

  // Human-readable expiry state for a share doc, used in both link lists.
  const expiryInfo = (share) => {
    if (!share?.expiresAt) {
      return { text: 'Never expires', className: 'text-warning', expired: false };
    }
    const ms = share.expiresAt.toMillis
      ? share.expiresAt.toMillis()
      : new Date(share.expiresAt.seconds ? share.expiresAt.seconds * 1000 : share.expiresAt).getTime();
    if (Number.isNaN(ms)) return { text: '', className: '', expired: false };
    if (ms <= Date.now()) return { text: 'Expired', className: 'text-danger fw-semibold', expired: true };
    const days = Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      text: days <= 7 ? `Expires in ${days} day${days === 1 ? '' : 's'}` : `Expires ${new Date(ms).toLocaleDateString()}`,
      className: days <= 7 ? 'text-warning' : 'text-muted',
      expired: false,
    };
  };

  // Generate a unique token
  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 20; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  // Load existing shares for this visit
  const loadExistingShares = async () => {
    if (!userId || !customerId || !visitId) return;

    setLoadingShares(true);
    try {
      const snapshot = await firebase.firestore()
        .collection('shared_visits')
        .where('userId', '==', userId)
        .where('customerId', '==', customerId)
        .where('visitId', '==', visitId)
        .get();

      const shares = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setExistingShares(shares);
    } catch (err) {
      console.error('Error loading shares:', err);
    }
    setLoadingShares(false);
  };

  // Load all shares for this user (across all customers/visits)
  const loadAllShares = async () => {
    if (!userId) return;

    setLoadingAllShares(true);
    try {
      const snapshot = await firebase.firestore()
        .collection('shared_visits')
        .where('userId', '==', userId)
        .get();

      const shares = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllShares(shares);
    } catch (err) {
      console.error('Error loading all shares:', err);
    }
    setLoadingAllShares(false);
  };

  // Recompute a customer's public-read marker from its live share links.
  //
  // The security rules grant login-less read of a customer's data while this
  // marker exists AND has not expired, so the marker must carry the LATEST
  // expiry among that customer's links: the customer stays readable exactly as
  // long as its longest-lived link. A link with no expiry (`expiresAt: null` —
  // anything created before expiry existed) keeps the marker open indefinitely,
  // which is why `neverExpires` wins over any date. If no live links remain the
  // marker is deleted and public read closes immediately.
  const refreshCustomerShareMarker = async (cid) => {
    if (!cid) return;
    const snap = await firebase.firestore()
      .collection('shared_visits')
      .where('customerId', '==', cid)
      .get();

    if (snap.empty) {
      await firebase.firestore().collection('shared_customers').doc(cid).delete();
      return;
    }

    let neverExpires = false;
    let latest = null;
    snap.forEach((doc) => {
      const exp = doc.data().expiresAt;
      if (!exp) { neverExpires = true; return; }
      const ms = exp.toMillis ? exp.toMillis() : new Date(exp).getTime();
      if (latest === null || ms > latest) latest = ms;
    });

    // Every link has expired — close public read rather than leaving it open.
    if (!neverExpires && latest !== null && latest <= Date.now()) {
      await firebase.firestore().collection('shared_customers').doc(cid).delete();
      return;
    }

    await firebase.firestore().collection('shared_customers').doc(cid).set(
      {
        shared: true,
        expiresAt: neverExpires
          ? null
          : firebase.firestore.Timestamp.fromMillis(latest),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  };

  // Generate new share link
  const generateShareLink = async () => {
    if (!customerId || !visitId || !userId) {
      setError('Missing required data. Please ensure a visit is loaded.');
      return;
    }

    setLoading(true);
    setError('');
    setCopied(false);

    try {
      const token = generateToken();
      // A share link is a bearer credential to this customer's whole history, so
      // it now carries a lifetime. `expiresAt: null` still means "never" — links
      // created before expiry existed keep working until revoked.
      const expiresAt = expiryDays
        ? firebase.firestore.Timestamp.fromDate(
            new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000)
          )
        : null;

      const shareData = {
        token,
        userId,
        customerId,
        visitId,
        customerName: customerName || 'Unknown Customer',
        visitName: visitName || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        expiresAt,
        accessCount: 0
      };

      await firebase.firestore()
        .collection('shared_visits')
        .doc(token)
        .set(shareData);

      // Mark this customer as publicly shared so the login-less viewer can read
      // its data under the read-isolation rules.
      await refreshCustomerShareMarker(customerId);

      const link = getShareUrl(token);
      setShareLink(link);

      // Reload existing shares and all shares
      loadExistingShares();
      loadAllShares();
    } catch (err) {
      console.error('Error generating share link:', err);
      setError('Failed to generate share link. Please try again.');
    }

    setLoading(false);
  };

  // Copy to clipboard
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

  // Revoke a share
  const revokeShare = async (shareId) => {
    const confirmed = await dialog.confirm('Revoke this share link? The customer will no longer be able to access the visit.', {
      title: 'Revoke Share',
      confirmText: 'Revoke',
      variant: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      // Remember which customer this share belonged to, to clean up its marker.
      const revoked = [...existingShares, ...allShares].find(s => s.id === shareId);
      const revokedCustomerId = revoked?.customerId || customerId;

      await firebase.firestore()
        .collection('shared_visits')
        .doc(shareId)
        .delete();

      // Recompute the customer's public-read marker from whatever links remain
      // (deletes it when none are left, and shortens the window when the link we
      // just revoked was the longest-lived one).
      await refreshCustomerShareMarker(revokedCustomerId);

      // Clear the link if it's the current one
      if (shareLink.includes(shareId)) {
        setShareLink('');
      }

      // Reload shares
      loadExistingShares();
      loadAllShares();
    } catch (err) {
      console.error('Error revoking share:', err);
      toast.error('Failed to revoke share link');
    }
  };

  // Load shares when modal opens
  useEffect(() => {
    if (isOpen) {
      loadExistingShares();
      loadAllShares();
    }
  }, [isOpen, userId, customerId, visitId]);

  if (!isOpen) return null;

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title d-flex align-items-center gap-2">
              <Link size={20} /> Share with Customer
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            />
          </div>

          <div className="modal-body">
            <div className="mb-3">
              <p className="text-muted mb-2">
                Generate a shareable link that allows your customer to view this visit's equipment status without signing in.
              </p>
              <div className="d-flex gap-2 small text-muted mb-3">
                <span><strong>Customer:</strong> {customerName || 'N/A'}</span>
                <span>|</span>
                <span><strong>Visit:</strong> {visitName || 'Current'}</span>
              </div>
            </div>

            {error && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}

            {!shareLink ? (
              <>
              <div className="mb-3">
                <label className="form-label" htmlFor="share-expiry">Link expires</label>
                <select
                  id="share-expiry"
                  className="form-select"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                >
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="365">In 1 year</option>
                  <option value="">Never</option>
                </select>
                <small className="text-muted">
                  {expiryDays
                    ? 'After this date the link stops working and the data is no longer publicly readable.'
                    : 'A link that never expires stays valid until you revoke it — including for visits logged in future.'}
                </small>
              </div>
              <button
                onClick={generateShareLink}
                disabled={loading}
                className="btn btn-primary w-100"
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Link size={16} className="me-2" />
                    Generate Share Link
                  </>
                )}
              </button>
              </>
            ) : (
              <div className="share-link-container">
                <div className="input-group mb-3">
                  <input
                    type="text"
                    className="form-control"
                    value={shareLink}
                    readOnly
                  />
                  <button
                    onClick={copyToClipboard}
                    className={`btn ${copied ? 'btn-success' : 'btn-outline-secondary'}`}
                    title="Copy to clipboard"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  <a
                    href={shareLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-primary"
                    title="Open in new tab"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>

                {copied && (
                  <div className="alert alert-success py-2 small">
                    Link copied to clipboard!
                  </div>
                )}

                <button
                  onClick={generateShareLink}
                  className="btn btn-outline-secondary btn-sm"
                >
                  Generate New Link
                </button>
              </div>
            )}

            {/* Existing Shares for This Visit */}
            {existingShares.length > 0 && (
              <div className="mt-4">
                <h6 className="mb-2">Active Shares for This Visit</h6>
                <div className="list-group">
                  {existingShares.map(share => (
                    <div
                      key={share.id}
                      className="list-group-item d-flex justify-content-between align-items-center"
                    >
                      <div className="small">
                        <div className="text-truncate" style={{ maxWidth: '200px' }}>
                          ...{share.token.slice(-8)}
                        </div>
                        <div className="text-muted">
                          {share.accessCount || 0} views
                          {share.createdAt && (
                            <> | Created {new Date(share.createdAt.toDate?.() || share.createdAt).toLocaleDateString()}</>
                          )}
                          {' | '}
                          <span className={expiryInfo(share).className}>{expiryInfo(share).text}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => revokeShare(share.id)}
                        className="btn btn-outline-danger btn-sm"
                        title="Revoke access"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Active Links across all customers - Collapsible */}
            <div className="mt-4">
              <h6
                className="mb-2"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => { setShowAllLinks(!showAllLinks); if (!showAllLinks && allShares.length === 0) loadAllShares(); }}
              >
                All Active Links {showAllLinks ? '▼' : '▶'}
              </h6>
              {!showAllLinks ? null : loadingAllShares ? (
                <div className="text-center py-3">
                  <span className="spinner-border spinner-border-sm me-2" role="status" />
                  Loading...
                </div>
              ) : allShares.length === 0 ? (
                <p className="text-muted small">No active share links.</p>
              ) : (
                <div className="list-group" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {allShares.map(share => (
                    <div
                      key={share.id}
                      className="list-group-item"
                    >
                      <div className="d-flex justify-content-between align-items-center">
                        <div className="small" style={{ minWidth: 0, flex: 1 }}>
                          <div className="fw-semibold">{share.customerName || 'Unknown Customer'}</div>
                          <div className="text-muted text-truncate">
                            {share.visitName || 'Unnamed Visit'} &middot; {share.accessCount || 0} views
                            {share.createdAt && (
                              <> &middot; {new Date(share.createdAt.toDate?.() || share.createdAt).toLocaleDateString()}</>
                            )}
                            {' · '}
                            <span className={expiryInfo(share).className}>{expiryInfo(share).text}</span>
                          </div>
                        </div>
                        <div className="d-flex gap-1 ms-2 flex-shrink-0">
                          <button
                            onClick={() => copyShareUrl(share.token, share.id)}
                            className={`btn btn-sm ${copiedShareId === share.id ? 'btn-success' : 'btn-outline-secondary'}`}
                            title="Copy link"
                          >
                            {copiedShareId === share.id ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <a
                            href={getShareUrl(share.token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-sm btn-outline-primary"
                            title="Open in new tab"
                          >
                            <ExternalLink size={14} />
                          </a>
                          <button
                            onClick={() => revokeShare(share.id)}
                            className="btn btn-sm btn-outline-danger"
                            title="Revoke access"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <small className="text-muted me-auto">
              Customers can view real-time updates
            </small>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
      {dialog.DialogComponent}
    </div>
  );
};

export default ShareModal;
