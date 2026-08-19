/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
}

interface ConfirmationDialogProps {
  confirmState: ConfirmState;
  onClose: () => void;
}

export default function ConfirmationDialog({ confirmState, onClose }: ConfirmationDialogProps) {
  if (!confirmState.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--color-bg-white)] rounded-xl shadow-2xl max-w-sm w-full border border-[var(--color-border-default)] p-6">
        <h3 className="font-bold text-lg mb-2">{confirmState.title}</h3>
        <p className="text-sm text-gray-600 mb-6">{confirmState.message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
          <button onClick={confirmState.onConfirm} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer shadow-sm ${
            confirmState.confirmLabel ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-[var(--brand-color)] text-white hover:bg-[var(--color-primary-hover)]'
          }`}>{confirmState.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
