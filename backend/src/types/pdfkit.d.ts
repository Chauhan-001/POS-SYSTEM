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
    pipe<T>(destination: T): T;
    fontSize(size: number): this;
    font(fontName: string): this;
    moveTo(x: number, y: number): this;
    fillColor(color: string): this;
    text(text: string, options?: { align?: string; width?: number; lineBreak?: boolean; continued?: boolean }): this;
    text(text: string, x?: number, y?: number, options?: { align?: string; width?: number; lineBreak?: boolean; continued?: boolean }): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    strokeColor(color: string): this;
    stroke(): this;
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
