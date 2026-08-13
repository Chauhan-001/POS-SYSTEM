/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ImageInput — reusable image field for the POS.
 *
 * Lets the user provide an image EITHER by uploading a file (stored on the
 * backend and served back as a URL) OR by pasting an image link. Both modes
 * converge on a single string value, so any consumer (offers, products,
 * branding, …) can offer upload-or-link with one component.
 *
 * Upload path: POST /api/media/upload (tenant-scoped, MIME + magic-byte
 * validated server-side). Offline uploads fail gracefully with a message and
 * the Link tab remains available.
 */

import React, { useRef, useState } from 'react';
import { Upload, Link2, Loader2, Trash2, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { uploadImage } from '../../src/api/client';

interface ImageInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Tailwind classes for the preview thumbnail (defaults to square). */
  previewClass?: string;
  hint?: string;
}

function looksLikeUploaded(value: string): boolean {
  return value.startsWith('data:image/') || value.startsWith('/uploads/');
}

export default function ImageInput({ value, onChange, label, previewClass, hint }: ImageInputProps) {
  const [tab, setTab] = useState<'upload' | 'link'>(value && !looksLikeUploaded(value) ? 'link' : 'upload');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [linkDraft, setLinkDraft] = useState(value && !looksLikeUploaded(value) ? value : '');
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, WEBP, SVG…).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image is too large — keep it under 5 MB.');
      return;
    }
    setUploading(true);
    setError('');
    const url = await uploadImage(file);
    setUploading(false);
    if (!url) {
      setError('Upload failed — check your connection and try again, or use the Link tab instead.');
      return;
    }
    onChange(url);
    setTab('upload');
  };

  const applyLink = () => {
    const v = linkDraft.trim();
    if (!v) return;
    if (!/^(https?:\/\/|\/uploads\/|data:image\/)/i.test(v)) {
      setError('That does not look like an image link — it should start with http://, https:// or /uploads/.');
      return;
    }
    setError('');
    onChange(v);
  };

  return (
    <div className="space-y-2">
      {label && <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wider mb-1">{label}</label>}

      {/* Preview */}
      {value ? (
        <div className="flex items-start gap-3">
          <div className={`${previewClass || 'w-20 h-20'} rounded-xl overflow-hidden border border-[#e1e2ed] bg-gray-50 flex items-center justify-center shrink-0`}>
            <img src={value} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
          </div>
          <div className="flex flex-col gap-1.5 items-start">
            <span className="text-[9px] text-gray-400 font-medium">{looksLikeUploaded(value) ? 'Uploaded image' : 'Image link'}</span>
            <button
              type="button"
              onClick={() => { onChange(''); setLinkDraft(''); setError(''); }}
              className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-100 cursor-pointer"
            >
              <Trash2 className="w-2.5 h-2.5" /> Remove image
            </button>
          </div>
        </div>
      ) : (
        /* Tab switcher */
        <div className="bg-gray-100 rounded-xl p-1 flex gap-1 w-fit">
          <button type="button" onClick={() => { setTab('upload'); setError(''); }}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${tab === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Upload className="w-3 h-3" /> Upload
          </button>
          <button type="button" onClick={() => { setTab('link'); setError(''); }}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${tab === 'link' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Link2 className="w-3 h-3" /> Use link
          </button>
        </div>
      )}

      {!value && tab === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-[#c3c6d7] rounded-xl px-4 py-5 text-center cursor-pointer hover:border-[var(--brand-color)] hover:bg-blue-50/40 transition-all"
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          {uploading ? (
            <span className="inline-flex items-center gap-2 text-xs font-bold text-gray-600">
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs font-bold text-gray-600">
              <ImageIcon className="w-4 h-4" /> Drag & drop an image or <span className="text-[var(--brand-color)] underline">browse</span>
            </span>
          )}
        </div>
      )}

      {!value && tab === 'link' && (
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="Paste an image link (https://…)"
            value={linkDraft}
            onChange={(e) => { setLinkDraft(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
            className="flex-1 px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
          />
          <button type="button" onClick={applyLink}
            className="px-3 py-1.5 bg-[var(--brand-color)] text-white rounded-lg text-[10px] font-black hover:bg-[#003ea8] transition-all cursor-pointer">
            Apply
          </button>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1 text-[10px] font-semibold text-red-600">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
      {hint && !error && <p className="text-[9px] text-gray-400">{hint}</p>}
    </div>
  );
}
