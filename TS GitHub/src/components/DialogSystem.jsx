// src/components/DialogSystem.jsx - Unified modal/dialog system
import { useState, useCallback, createContext, useContext } from 'react';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Context for dialog system
const DialogContext = createContext(null);

// Dialog types
const DIALOG_TYPES = {
  ALERT: 'alert',
  CONFIRM: 'confirm',
  PROMPT: 'prompt',
};

// Icon components for different dialog variants
const DialogIcon = ({ variant }) => {
  const iconClass = 'w-12 h-12 mx-auto mb-4';

  switch (variant) {
    case 'success':
      return <CheckCircleIcon className={`${iconClass} text-success`} />;
    case 'warning':
      return <ExclamationTriangleIcon className={`${iconClass} text-warning`} />;
    case 'danger':
      return <XCircleIcon className={`${iconClass} text-error`} />;
    case 'info':
    default:
      return <InformationCircleIcon className={`${iconClass} text-info`} />;
  }
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
}) => {
  const [inputValue, setInputValue] = useState(inputDefaultValue);

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
    if (e.key === 'Enter' && type !== DIALOG_TYPES.PROMPT) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (!isOpen) return null;

  const btnVariant = variant === 'danger' ? 'btn-error' : 'btn-primary';

  return (
    <div className="modal modal-open" onKeyDown={handleKeyDown}>
      <div className="modal-box">
        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          onClick={handleCancel}
          aria-label="Close"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        <div className="text-center pt-4">
          <DialogIcon variant={variant} />

          <h3 className="font-bold text-lg mb-2">{title}</h3>

          {message && (
            <p className="py-2 whitespace-pre-line text-base-content/80">{message}</p>
          )}

          {type === DIALOG_TYPES.PROMPT && (
            <div className="form-control w-full mt-4">
              {inputLabel && (
                <label className="label">
                  <span className="label-text">{inputLabel}</span>
                </label>
              )}
              <input
                type={inputType}
                className="input input-bordered w-full"
                placeholder={inputPlaceholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                  }
                }}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="modal-action justify-center">
          {(type === DIALOG_TYPES.CONFIRM || type === DIALOG_TYPES.PROMPT) && (
            <button className="btn btn-ghost" onClick={handleCancel}>
              {cancelText}
            </button>
          )}
          <button
            className={`btn ${btnVariant}`}
            onClick={handleConfirm}
            autoFocus={type === DIALOG_TYPES.ALERT}
          >
            {confirmText}
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/50" onClick={handleCancel}></div>
    </div>
  );
};

// Toast notification component
export const Toast = ({ message, variant = 'success', isVisible, onClose }) => {
  if (!isVisible) return null;

  const alertClass = {
    success: 'alert-success',
    danger: 'alert-error',
    warning: 'alert-warning',
    info: 'alert-info',
  }[variant] || 'alert-info';

  return (
    <div className="toast toast-end toast-bottom z-50">
      <div className={`alert ${alertClass}`}>
        <span>{message}</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          <XMarkIcon className="w-4 h-4" />
        </button>
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
    resolve: null,
  });

  const [toastState, setToastState] = useState({
    isVisible: false,
    message: '',
    variant: 'success',
  });

  const closeDialog = useCallback(() => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
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
        resolve,
      });
    });
  }, []);

  // Success alert
  const success = useCallback(
    (message, options = {}) => {
      return alert(message, { ...options, variant: 'success', title: options.title || 'Success' });
    },
    [alert]
  );

  // Error alert
  const error = useCallback(
    (message, options = {}) => {
      return alert(message, { ...options, variant: 'danger', title: options.title || 'Error' });
    },
    [alert]
  );

  // Warning alert
  const warning = useCallback(
    (message, options = {}) => {
      return alert(message, { ...options, variant: 'warning', title: options.title || 'Warning' });
    },
    [alert]
  );

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
        resolve,
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
        resolve,
      });
    });
  }, []);

  // Toast notification
  const toast = useCallback((message, options = {}) => {
    setToastState({
      isVisible: true,
      message,
      variant: options.variant || 'success',
    });

    setTimeout(() => {
      setToastState((prev) => ({ ...prev, isVisible: false }));
    }, options.duration || 3000);
  }, []);

  const handleConfirm = useCallback(
    (value) => {
      if (dialogState.resolve) {
        if (dialogState.type === DIALOG_TYPES.PROMPT) {
          dialogState.resolve(value);
        } else {
          dialogState.resolve(true);
        }
      }
    },
    [dialogState]
  );

  const handleCancel = useCallback(() => {
    if (dialogState.resolve) {
      if (dialogState.type === DIALOG_TYPES.PROMPT) {
        dialogState.resolve(null);
      } else {
        dialogState.resolve(false);
      }
    }
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
      />
      <Toast
        message={toastState.message}
        variant={toastState.variant}
        isVisible={toastState.isVisible}
        onClose={() => setToastState((prev) => ({ ...prev, isVisible: false }))}
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
    toast,
    DialogComponent,
  };
};

export { Dialog, DIALOG_TYPES };
export default Dialog;
