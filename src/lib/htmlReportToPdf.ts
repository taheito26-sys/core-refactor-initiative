/**
 * Shared "render a styled HTML report straight to a downloaded PDF, no print
 * dialog" pipeline. Originally lived only in orders-export.ts; pulled out so
 * every report in the app (orders, buyer statements, …) can save a real PDF
 * file locally instead of routing through the browser's print dialog.
 *
 * Deliberately NOT html2canvas: html2canvas re-implements text layout itself
 * (drawing glyph-by-glyph onto a canvas 2D context), and it breaks Arabic
 * letter joining/ordering. A `<foreignObject>` is laid out and painted by the
 * browser's own text-shaping engine when the SVG is decoded as an image, so
 * RTL/Arabic comes out exactly as it renders on screen.
 */

/** Pulls the `<style>` rules and each `.sheet` card back out of a full report document, one per logical page. */
export function extractReportSheets(html: string): { styles: string; sheets: string[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const styleEl = doc.querySelector('style');
  const sheets = Array.from(doc.querySelectorAll('.sheet')).map(el => el.outerHTML);
  return {
    styles: styleEl?.textContent || '',
    sheets,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * Builds the `<svg><foreignObject>` wrapper through real DOM nodes and lets
 * the browser's own XMLSerializer produce the XML text, rather than
 * hand-concatenating a string. A statement can carry text pasted or
 * imported from elsewhere (WhatsApp, Excel, exchange data) that contains
 * characters our own `escapeHtml` — which only covers `& < > " '` — doesn't
 * account for; building through the DOM means whatever ends up in `html`
 * gets serialized back out correctly no matter what's in it, instead of
 * silently producing invalid XML that Chrome then refuses to decode as an
 * image ("EncodingError: The source image cannot be decoded").
 *
 * Deliberately a `data:` URI, not a `blob:` one — Chrome taints the canvas
 * ("SecurityError: Tainted canvases may not be exported" on the later
 * `toDataURL()`) for an SVG-with-foreignObject image loaded from a `blob:`
 * URL, even same-origin and with no external resources involved, but not
 * for the same content loaded from a `data:` URI.
 */
async function svgImageFromHtml(html: string, width: number, height: number): Promise<HTMLImageElement> {
  const svgEl = document.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
  const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
  foreignObject.setAttribute('width', '100%');
  foreignObject.setAttribute('height', '100%');
  const container = document.createElementNS(XHTML_NS, 'div');
  container.innerHTML = html;
  foreignObject.appendChild(container);
  svgEl.appendChild(foreignObject);

  const svgString = new XMLSerializer().serializeToString(svgEl);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  try {
    await img.decode();
  } catch (err) {
    console.error('svgImageFromHtml decode failed', { width, height, svgLength: svgString.length });
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} (w=${width} h=${height} svgLen=${svgString.length})`,
    );
  }
  return img;
}

export interface HtmlReportToPdfOptions {
  orientation?: 'portrait' | 'landscape';
  renderWidth?: number;
}

/**
 * Renders a full report HTML document to an actual PDF file and downloads it
 * directly — no print dialog. Each `.sheet` in the document becomes its own
 * PDF page (never merged with a neighboring sheet into one giant sliced
 * image — that produced a stray hard cut wherever the slice boundary landed
 * mid-table). A single sheet whose own content is still taller than one
 * physical page is sliced within itself, the same as before.
 */
export async function renderHtmlReportToPdf(
  reportHtml: string,
  filename: string,
  options: HtmlReportToPdfOptions = {},
): Promise<void> {
  if (typeof document === 'undefined') return;
  const { orientation = 'portrait', renderWidth = orientation === 'landscape' ? 1080 : 800 } = options;
  const { styles, sheets } = extractReportSheets(reportHtml);
  if (sheets.length === 0) return;

  const scale = 2;

  // Dynamically imported so jsPDF only loads into a device's bundle when a
  // PDF export is actually triggered.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 0; i < sheets.length; i++) {
    const sheetHtml = sheets[i];

    // Measure real layout height first — the SVG needs explicit width/height
    // up front, and foreignObject content doesn't reflow after the fact.
    const measurer = document.createElement('div');
    measurer.style.cssText = `position:absolute;left:-9999px;top:0;width:${renderWidth}px;background:#fff;`;
    measurer.innerHTML = `<style>${styles}</style>${sheetHtml}`;
    document.body.appendChild(measurer);
    const renderHeight = measurer.scrollHeight;
    measurer.remove();

    const img = await svgImageFromHtml(`<style>${styles}</style>${sheetHtml}`, renderWidth, renderHeight);
    const canvas = document.createElement('canvas');
    canvas.width = renderWidth * scale;
    canvas.height = renderHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, renderWidth, renderHeight);
    ctx.drawImage(img, 0, 0, renderWidth, renderHeight);

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (i > 0) doc.addPage();
    let heightLeft = imgHeight;
    let position = 0;
    doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position -= pageHeight;
      doc.addPage();
      doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
  }

  doc.save(filename);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
