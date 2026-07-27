// src/components/ServiceReportUpload.jsx
import { useState, useRef } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import 'firebase/compat/firestore';
import { Upload, FileText, Trash2, ExternalLink, Loader } from 'lucide-react';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

const ServiceReportUpload = ({ userId, customerId, visitId, currentReportUrl, onReportUploaded }) => {
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
          // Get download URL
          const downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();

          // Update visit document with the report URL
          await firebase.firestore()
            .collection('user_files')
            .doc(userId)
            .collection('customers')
            .doc(customerId)
            .collection('visits')
            .doc(visitId)
            .update({
              serviceReportUrl: downloadUrl,
              serviceReportUploadedAt: new Date().toISOString()
            });

          setUploading(false);
          setUploadProgress(0);

          if (onReportUploaded) {
            onReportUploaded(downloadUrl);
          }

          toast.success('Service report uploaded successfully!');
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
        .collection('visits')
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
          <a
            href={currentReportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline-primary"
          >
            <FileText size={16} className="me-1" />
            View Report
            <ExternalLink size={14} className="ms-1" />
          </a>
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
