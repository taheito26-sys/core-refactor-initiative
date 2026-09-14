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

/** Elements that must never be sliced in half across a page break. */
const UNBREAKABLE_SELECTOR = 'tr, .card, .settlement, .legal, h2';

/**
 * Reads the top/bottom of every unbreakable element in the measured sheet,
 * in the same px coordinate space as `scrollHeight`. A mobile browser
 * substitutes different fonts than desktop for the 'Tahoma'/'Segoe UI'
 * stack (neither ships on Android), which changes Arabic line-height/row
 * height enough to push a sheet from fitting one page to spilling a few
 * rows onto a second — and without this, whichever pixel row the page-break
 * math lands on gets rendered cut in half, chopping a payment row or the
 * ledger total mid-cell instead of moving it cleanly to the next page.
 */
function measureUnbreakableRanges(measurer: HTMLElement): Array<[number, number]> {
  const containerTop = measurer.getBoundingClientRect().top;
  return Array.from(measurer.querySelectorAll(UNBREAKABLE_SELECTOR)).map(el => {
    const rect = el.getBoundingClientRect();
    return [rect.top - containerTop, rect.bottom - containerTop] as [number, number];
  });
}

// Generous on purpose: the off-screen measurer div and the actual
// foreignObject-rasterized image are two separate layout passes, and even
// on one device their row positions can disagree by a few px (subpixel
// font hinting, foreignObject's own nested viewport). A tight tolerance
// here was still letting a row's last couple of pixels peek through onto
// the wrong page instead of moving the whole row.
const ROW_SAFETY_PX = 6;

/**
 * Splits `totalHeight` px of content into page-sized slices (each capped at
 * `budget` px), nudging any slice boundary that would fall inside one of
 * `ranges` — expanded by `ROW_SAFETY_PX` on each side — back to that range's
 * start so a row/card/heading always moves to the next page whole rather
 * than being cut across the page break.
 */
function computePageSlices(totalHeight: number, budget: number, ranges: Array<[number, number]>): number[] {
  const slices: number[] = [];
  let cursor = 0;
  while (cursor < totalHeight - 0.5) {
    let end = Math.min(cursor + budget, totalHeight);
    const collision = ranges.find(([top, bottom]) => end > top - ROW_SAFETY_PX && end < bottom + ROW_SAFETY_PX);
    if (collision) end = Math.max(cursor, collision[0] - ROW_SAFETY_PX);
    // A single element taller than the whole page budget (shouldn't happen
    // for a table row, but guards against an infinite loop either way).
    if (end <= cursor) end = Math.min(cursor + budget, totalHeight);
    slices.push(end - cursor);
    cursor = end;
  }
  return slices;
}

/**
 * Renders a full report HTML document to an actual PDF file and downloads it
 * directly — no print dialog. Each `.sheet` in the document becomes its own
 * PDF page (never merged with a neighboring sheet into one giant sliced
 * image — that produced a stray hard cut wherever the slice boundary landed
 * mid-table). A single sheet whose own content is still taller than one
 * physical page is sliced within itself, with slice boundaries nudged to
 * never fall inside a table row (or card/heading), so overflow content
 * moves to the next page intact instead of being rendered cut in half.
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
  // A page-edge margin — the image used to be stretched flush to every
  // edge of the page, which read as a raw screenshot rather than a
  // printed document.
  const margin = 12;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const ptPerPx = usableWidth / renderWidth;
  const budgetPx = usableHeight / ptPerPx;

  for (let i = 0; i < sheets.length; i++) {
    const sheetHtml = sheets[i];

    // Measure real layout height (and every unbreakable element's box) on
    // this same device before rasterizing — the SVG needs explicit
    // width/height up front, and foreignObject content doesn't reflow
    // after the fact.
    const measurer = document.createElement('div');
    measurer.style.cssText = `position:absolute;left:-9999px;top:0;width:${renderWidth}px;background:#fff;`;
    measurer.innerHTML = `<style>${styles}</style>${sheetHtml}`;
    document.body.appendChild(measurer);
    // A padded, not exact, canvas/SVG height: an off-screen measurer div and
    // the actual foreignObject rasterization are two separate layout
    // engines, and on some mobile browsers the real rendered content comes
    // out a handful of px taller than `scrollHeight` reported — an SVG root
    // clips to its own height by default, so an under-measured height was
    // silently slicing the true bottom edge off the image (a table's last
    // row/total showing cut in half with blank canvas below it, never
    // reaching the page-break logic at all since the whole sheet still
    // "fit" by the too-small measurement). The padding is inert extra white
    // space when the measurement was accurate.
    const RENDER_HEIGHT_PADDING_PX = 32;
    const renderHeight = measurer.scrollHeight + RENDER_HEIGHT_PADDING_PX;
    const unbreakableRanges = measureUnbreakableRanges(measurer);
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
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const slicesPx = computePageSlices(renderHeight, budgetPx, unbreakableRanges);

    if (i > 0) doc.addPage();
    let position = margin;
    for (let s = 0; s < slicesPx.length; s++) {
      if (s > 0) {
        position -= slicesPx[s - 1] * ptPerPx;
        doc.addPage();
      }
      doc.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
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
