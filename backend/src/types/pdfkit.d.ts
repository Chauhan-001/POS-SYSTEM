/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal type declarations for pdfkit (no official types shipped).
 * Only the API surface used by the export service is declared.
 */

declare module 'pdfkit' {
  import { EventEmitter } from 'events';

  interface PDFDocumentOptions {
    size?: string | number[];
    margin?: number;
    [key: string]: unknown;
  }

  class PDFDocument extends EventEmitter {
    constructor(options?: PDFDocumentOptions);
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(text: string, options?: { align?: string; width?: number; lineBreak?: boolean }): this;
    text(text: string, x?: number, y?: number, options?: { align?: string; width?: number; lineBreak?: boolean }): this;
    moveDown(lines?: number): this;
    rect(x: number, y: number, w: number, h: number): this;
    fill(color?: string): this;
    heightOfString(text: string, options?: { width?: number }): number;
    addPage(): this;
    page: { width: number; height: number; [key: string]: unknown };
    y: number;
    end(): void;
  }

  export = PDFDocument;
}
