// src/components/DialogSystem.jsx - Unified modal/dialog system
import { useState, useCallback, createContext, useContext } from 'react';
import { X, AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

// Context for dialog system
const DialogContext = createContext(null);

// Dialog types
const DIALOG_TYPES = {
  ALERT: 'alert',
  CONFIRM: 'confirm',
  PROMPT: 'prompt',
  CHOICE: 'choice',
  CUSTOM: 'custom'
};

// Icon components for different dialog types
const DialogIcon = ({ type, variant }) => {
  const iconProps = { size: 48, className: 'mb-3' };

  if (variant === 'success') return <CheckCircle {...iconProps} className="mb-3 text-success" />;
  if (variant === 'warning') return <AlertTriangle {...iconProps} className="mb-3 text-warning" />;
  if (variant === 'danger') return <AlertCircle {...iconProps} className="mb-3 text-danger" />;
  if (variant === 'info') return <Info {...iconProps} className="mb-3 text-info" />;

  return null;
};

// Base Dialog Component
const Dialog = ({
  isOpen,
  onClose,
  title,
  message,
  type = DIALOG_TYPES.ALERT,
  variant = 'info',
  confirmText = 'OK',
  cancelText = 'Cancel',
  inputLabel = '',
  inputPlaceholder = '',
  inputDefaultValue = '',
  inputType = 'text',
  onConfirm,
  onCancel,
  onChoose,
  choices,
  children
}) => {
  const [inputValue, setInputValue] = useState(inputDefaultValue);
  useBodyScrollLock(isOpen);

  const handleConfirm = () => {
    if (type === DIALOG_TYPES.PROMPT) {
      onConfirm?.(inputValue);
    } else {
      onConfirm?.();
    }
    onClose();
  };

  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  const handleKeyDown = (e) => {
    // A choice dialog has no single "confirm" action, so Enter must not fire one
    // — it would resolve the promise with `true` instead of a choice key.
    if (e.key === 'Enter' && type !== DIALOG_TYPES.PROMPT && type !== DIALOG_TYPES.CHOICE) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={handleCancel}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div
        className="modal-dialog modal-dialog-centered"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="dialog-title">{title}</h5>
            <button
              type="button"
              className="btn-close"
              onClick={handleCancel}
              aria-label="Close"
            />
          </div>

          <div className="modal-body text-center">
            <DialogIcon type={type} variant={variant} />

            {message && (
              <p className="mb-3" style={{ whiteSpace: 'pre-line' }}>{message}</p>
            )}

            {type === DIALOG_TYPES.PROMPT && (
              <div className="text-start">
                {inputLabel && (
                  <label className="form-label">{inputLabel}</label>
                )}
                <input
                  type={inputType}
                  className="form-control"
                  placeholder={inputPlaceholder}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirm();
                    }
                  }}
                  autoFocus
                />
              </div>
            )}

            {/* A choice dialog renders one full-width button per option. Stacked
                rather than a footer row so the labels stay readable on a phone. */}
            {type === DIALOG_TYPES.CHOICE && (
              <div className="d-grid gap-2 text-start">
                {(choices || []).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`btn btn-${c.variant || 'outline-primary'} text-start`}
                    onClick={() => onChoose?.(c.key)}
                  >
                    <div className="fw-semibold">{c.label}</div>
                    {c.description && (
                      <div className="small opacity-75">{c.description}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {children}
          </div>

          <div className="modal-footer justify-content-center">
            {type === DIALOG_TYPES.CHOICE && (
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                {cancelText}
              </button>
            )}
            {(type === DIALOG_TYPES.CONFIRM || type === DIALOG_TYPES.PROMPT) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancel}
              >
                {cancelText}
              </button>
            )}
            {type !== DIALOG_TYPES.CHOICE && (
              <button
                type="button"
                className={`btn btn-${variant === 'danger' ? 'danger' : 'primary'}`}
                onClick={handleConfirm}
                autoFocus={type === DIALOG_TYPES.ALERT}
              >
                {confirmText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Add Line Dialog - specific dialog for adding lines
export const AddLineDialog = ({ isOpen, onClose, onAdd, defaultHeadCount = 14 }) => {
  const [lineName, setLineName] = useState('');
  useBodyScrollLock(isOpen);
  const [headCount, setHeadCount] = useState(defaultHeadCount.toString());
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e?.preventDefault();

    if (!lineName.trim()) {
      setError('Please enter a line name');
      return;
    }

    const count = parseInt(headCount);
    if (isNaN(count) || count < 1 || count > 50) {
      setError('Head count must be between 1 and 50');
      return;
    }

    onAdd(lineName.trim(), count);
    setLineName('');
    setHeadCount(defaultHeadCount.toString());
    setError('');
    onClose();
  };

  const handleClose = () => {
    setLineName('');
    setHeadCount(defaultHeadCount.toString());
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-dialog modal-dialog-centered"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Add New Line</h5>
            <button
              type="button"
              className="btn-close"
              onClick={handleClose}
              aria-label="Close"
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && (
                <div className="alert alert-danger py-2 mb-3">
                  {error}
                </div>
              )}

              <div className="mb-3">
                <label className="form-label">Line Name *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g., Line 1, Packing Line A"
                  value={lineName}
                  onChange={e => setLineName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="mb-3">
                <label className="form-label">Number of Heads *</label>
                <input
                  type="number"
                  className="form-control"
                  min="1"
                  max="50"
                  value={headCount}
                  onChange={e => setHeadCount(e.target.value)}
                />
                <small className="text-muted">How many heads does this line have?</small>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
              >
                Add Line
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// Toast notification component
export const Toast = ({ message, variant = 'success', isVisible, onClose }) => {
  if (!isVisible) return null;

  const bgClass = {
    success: 'bg-success',
    danger: 'bg-danger',
    warning: 'bg-warning',
    info: 'bg-info'
  }[variant] || 'bg-primary';

  return (
    <div
      className="position-fixed bottom-0 end-0 p-3"
      style={{ zIndex: 9999 }}
    >
      <div
        className={`toast show ${bgClass} text-white`}
        role="alert"
        aria-live="assertive"
      >
        <div className="d-flex align-items-center p-2">
          <div className="toast-body flex-grow-1">
            {message}
          </div>
          <button
            type="button"
            className="btn-close btn-close-white me-2"
            onClick={onClose}
            aria-label="Close"
          />
        </div>
      </div>
    </div>
  );
};

// Custom hook for using the dialog system
export const useDialog = () => {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    type: DIALOG_TYPES.ALERT,
    title: '',
    message: '',
    variant: 'info',
    confirmText: 'OK',
    cancelText: 'Cancel',
    inputLabel: '',
    inputPlaceholder: '',
    inputDefaultValue: '',
    inputType: 'text',
    choices: null,
    resolve: null
  });

  const [toastState, setToastState] = useState({
    isVisible: false,
    message: '',
    variant: 'success'
  });

  const closeDialog = useCallback(() => {
    setDialogState(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Alert - simple message display
  const alert = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        type: DIALOG_TYPES.ALERT,
        title: options.title || 'Notice',
        message,
        variant: options.variant || 'info',
        confirmText: options.confirmText || 'OK',
        cancelText: 'Cancel',
        resolve
      });
    });
  }, []);

  // Success alert
  const success = useCallback((message, options = {}) => {
    return alert(message, { ...options, variant: 'success', title: options.title || 'Success' });
  }, [alert]);

  // Error alert
  const error = useCallback((message, options = {}) => {
    return alert(message, { ...options, variant: 'danger', title: options.title || 'Error' });
  }, [alert]);

  // Warning alert
  const warning = useCallback((message, options = {}) => {
    return alert(message, { ...options, variant: 'warning', title: options.title || 'Warning' });
  }, [alert]);

  // Confirm - yes/no dialog
  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        type: DIALOG_TYPES.CONFIRM,
        title: options.title || 'Confirm',
        message,
        variant: options.variant || 'warning',
        confirmText: options.confirmText || 'Yes',
        cancelText: options.cancelText || 'Cancel',
        resolve
      });
    });
  }, []);

  // Prompt - input dialog
  const prompt = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        type: DIALOG_TYPES.PROMPT,
        title: options.title || 'Input',
        message,
        variant: options.variant || 'info',
        confirmText: options.confirmText || 'OK',
        cancelText: options.cancelText || 'Cancel',
        inputLabel: options.inputLabel || '',
        inputPlaceholder: options.placeholder || '',
        inputDefaultValue: options.defaultValue || '',
        inputType: options.inputType || 'text',
        resolve
      });
    });
  }, []);

  // Choice - pick one of several named options. Resolves the chosen option's
  // key, or null if dismissed. Used where a yes/no confirm can't express the
  // question (e.g. "new visit: carry setup / carry everything / blank").
  const choice = useCallback((message, choices, options = {}) => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        type: DIALOG_TYPES.CHOICE,
        title: options.title || 'Choose',
        message,
        variant: options.variant || 'info',
        confirmText: '',
        cancelText: options.cancelText || 'Cancel',
        choices,
        resolve
      });
    });
  }, []);

  // Toast notification
  const toast = useCallback((message, options = {}) => {
    setToastState({
      isVisible: true,
      message,
      variant: options.variant || 'success'
    });

    setTimeout(() => {
      setToastState(prev => ({ ...prev, isVisible: false }));
    }, options.duration || 3000);
  }, []);

  const handleConfirm = useCallback((value) => {
    if (dialogState.resolve) {
      if (dialogState.type === DIALOG_TYPES.PROMPT) {
        dialogState.resolve(value);
      } else {
        dialogState.resolve(true);
      }
    }
  }, [dialogState]);

  const handleCancel = useCallback(() => {
    if (dialogState.resolve) {
      if (dialogState.type === DIALOG_TYPES.PROMPT) {
        dialogState.resolve(null);
      } else {
        dialogState.resolve(false);
      }
    }
  }, [dialogState]);

  const handleChoose = useCallback((key) => {
    if (dialogState.resolve) dialogState.resolve(key);
    setDialogState(prev => ({ ...prev, isOpen: false, resolve: null }));
  }, [dialogState]);

  // Dialog component to render
  const DialogComponent = (
    <>
      <Dialog
        isOpen={dialogState.isOpen}
        onClose={closeDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        variant={dialogState.variant}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        inputLabel={dialogState.inputLabel}
        inputPlaceholder={dialogState.inputPlaceholder}
        inputDefaultValue={dialogState.inputDefaultValue}
        inputType={dialogState.inputType}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        onChoose={handleChoose}
        choices={dialogState.choices}
      />
      <Toast
        message={toastState.message}
        variant={toastState.variant}
        isVisible={toastState.isVisible}
        onClose={() => setToastState(prev => ({ ...prev, isVisible: false }))}
      />
    </>
  );

  return {
    alert,
    success,
    error,
    warning,
    confirm,
    prompt,
    choice,
    toast,
    DialogComponent
  };
};

export { Dialog, DIALOG_TYPES };
export default Dialog;
