// src/components/ServiceReportUpload.jsx
import { useState, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import 'firebase/compat/firestore';
import { Upload, FileText, Trash2, ExternalLink, Loader } from 'lucide-react';
import { fetchAuthedMedia } from '../config/media.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

// `collectionName` because the two apps keep their records in different
// collections — JTI's service visits in `visits`, a plant's shifts in
// `dailyLogs`. This was hardcoded to 'visits', so uploading from the plant app
// wrote to a document that does not exist there and the report was never
// recorded against the log.
const ServiceReportUpload = ({ userId, customerId, visitId, currentReportUrl, onReportUploaded, collectionName = 'visits',
  // A plant may READ the service report for a visit — it is the write-up of
  // work done on their machines, and hiding it served nobody — but the report
  // is JTI's record, so replacing or deleting it stays with JTI.
  readOnly = false }) => {
  const [opening, setOpening] = useState(false);

  // The report's object path is fully determined by the ids, so legacy visits
  // (which only stored a URL) resolve too — no backfill needed.
  const reportPath = () => `service-reports/${userId}/${customerId}/${visitId}.pdf`;

  // Fetch through the broker and open the blob. An <a href> can't carry an
  // Authorization header, and the stored URL no longer works once the public
  // token is stripped.
  const handleView = async () => {
    setOpening(true);
    try {
      const objUrl = await fetchAuthedMedia(reportPath());
      window.open(objUrl, '_blank', 'noopener');
      // Give the new tab time to load before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    } catch (err) {
      console.error('Could not open service report:', err);
      if (currentReportUrl) window.open(currentReportUrl, '_blank', 'noopener'); // legacy fallback
      else setError('Could not open the report. Please try again.');
    } finally {
      setOpening(false);
    }
  };

  const toast = useToast();
  const dialog = useDialog();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setError('Please select a PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    if (!userId || !customerId || !visitId) {
      setError('Please save the visit first before uploading a report');
      return;
    }

    setError('');
    setUploading(true);
    setUploadProgress(0);

    try {
      // Create storage reference
      const storageRef = firebase.storage().ref();
      const reportRef = storageRef.child(`service-reports/${userId}/${customerId}/${visitId}.pdf`);

      // Upload file with progress tracking
      const uploadTask = reportRef.put(file);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        (error) => {
          console.error('Upload error:', error);
          setError('Failed to upload file: ' + error.message);
          setUploading(false);
        },
        async () => {
          // Everything past this point runs in an async callback that nothing
          // awaits, so a throw here becomes an unhandled rejection and the
          // spinner sticks at 100% forever with no error and no report. It is
          // exactly what happened. Whatever goes wrong, the UI must come back.
          try {
            // Firebase mints a PUBLIC download token on upload whose URL
            // bypasses Storage rules. Strip it so the report is reachable only
            // through the media broker.
            try {
              await uploadTask.snapshot.ref.updateMetadata({
                customMetadata: { firebaseStorageDownloadTokens: '' },
              });
            } catch (metaErr) {
              console.warn('Could not revoke public token for service report:', metaErr?.message || metaErr);
            }

            // NOT getDownloadURL(). That call returns a tokenised URL, and the
            // token is the thing just revoked — so after the strip it fails,
            // which is what hung the upload. Nothing reads this field as a URL
            // any more: the viewer derives the object path from the ids and
            // fetches it through the broker. It is stored as the "a report
            // exists" flag the rest of the app tests for truthiness.
            const reportRefPath = reportPath();

            await firebase.firestore()
              .collection('user_files')
              .doc(userId)
              .collection('customers')
              .doc(customerId)
              .collection(collectionName)
              .doc(visitId)
              .update({
                serviceReportUrl: reportRefPath,
                serviceReportUploadedAt: new Date().toISOString()
              });

            if (onReportUploaded) onReportUploaded(reportRefPath);
            toast.success('Service report uploaded');
          } catch (err) {
            console.error('Service report finalise failed:', err);
            setError('Uploaded, but could not record it on the visit: ' + (err?.message || 'unknown error'));
          } finally {
            setUploading(false);
            setUploadProgress(0);
          }
        }
      );
    } catch (err) {
      console.error('Upload error:', err);
      setError('Failed to upload: ' + err.message);
      setUploading(false);
    }

    // Clear the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    const confirmed = await dialog.confirm('Delete the service report? This cannot be undone.', {
      title: 'Delete Service Report',
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      // Delete from storage
      const storageRef = firebase.storage().ref();
      const reportRef = storageRef.child(`service-reports/${userId}/${customerId}/${visitId}.pdf`);

      try {
        await reportRef.delete();
      } catch (e) {
        // File might not exist, continue anyway
        console.log('File may not exist in storage:', e);
      }

      // Remove URL from visit document
      await firebase.firestore()
        .collection('user_files')
        .doc(userId)
        .collection('customers')
        .doc(customerId)
        .collection(collectionName)
        .doc(visitId)
        .update({
          serviceReportUrl: firebase.firestore.FieldValue.delete(),
          serviceReportUploadedAt: firebase.firestore.FieldValue.delete()
        });

      if (onReportUploaded) {
        onReportUploaded(null);
      }

      toast.success('Service report deleted');
    } catch (err) {
      console.error('Delete error:', err);
      setError('Failed to delete: ' + err.message);
    }
  };

  // Nothing to show and nothing to be done: don't take up the space.
  if (readOnly && !currentReportUrl) return null;

  return (
    <div className="service-report-upload">
      <label className="form-label"><strong>Service Report (PDF):</strong></label>

      {error && (
        <div className="alert alert-danger py-2 mb-2" role="alert">
          {error}
        </div>
      )}

      {currentReportUrl ? (
        <div className="d-flex gap-2 align-items-center">
          <button
            type="button"
            onClick={handleView}
            disabled={opening}
            className="btn btn-sm btn-outline-primary"
          >
            <FileText size={16} className="me-1" />
            {opening ? 'Opening…' : 'View Report'}
            <ExternalLink size={14} className="ms-1" />
          </button>
          {!readOnly && (
            <>
              <button
                onClick={handleDelete}
                className="btn btn-sm btn-outline-danger"
                title="Delete report"
              >
                <Trash2 size={16} />
              </button>
              <label className="btn btn-sm btn-outline-secondary mb-0">
                <Upload size={16} className="me-1" />
                Replace
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  disabled={uploading}
                />
              </label>
            </>
          )}
        </div>
      ) : (
        <div>
          {uploading ? (
            <div className="d-flex align-items-center gap-2">
              <Loader size={16} className="spinner-border spinner-border-sm" />
              <span>Uploading... {uploadProgress}%</span>
              <div className="progress flex-grow-1" style={{ height: '6px' }}>
                <div
                  className="progress-bar"
                  role="progressbar"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <label className="btn btn-sm btn-outline-primary mb-0">
              <Upload size={16} className="me-1" />
              Upload Service Report
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>
          )}
          {!visitId && (
            <small className="text-muted d-block mt-1">
              Save the visit first to upload a service report
            </small>
          )}
        </div>
      )}
      {dialog.DialogComponent}
    </div>
  );
};

export default ServiceReportUpload;
