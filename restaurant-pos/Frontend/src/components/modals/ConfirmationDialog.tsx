/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

interface ConfirmationDialogProps {
  confirmState: ConfirmState;
  onClose: () => void;
}

export default function ConfirmationDialog({ confirmState, onClose }: ConfirmationDialogProps) {
  if (!confirmState.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
        <h3 className="font-bold text-lg mb-2">{confirmState.title}</h3>
        <p className="text-sm text-gray-600 mb-6">{confirmState.message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
          <button onClick={confirmState.onConfirm} className="px-4 py-2 bg-[#004ac6] text-white rounded-lg text-xs font-bold hover:bg-[#003ea8] cursor-pointer shadow-sm">Confirm</button>
        </div>
      </div>
    </div>
  );
}
