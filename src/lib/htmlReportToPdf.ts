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

/** Pulls the `<style>` rules and the `.sheet` card(s) back out of a full report document. */
export function extractReportFragment(html: string): { styles: string; sheetHtml: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const styleEl = doc.querySelector('style');
  const sheets = Array.from(doc.querySelectorAll('.sheet'));
  return {
    styles: styleEl?.textContent || '',
    sheetHtml: sheets.map(el => el.outerHTML).join(''),
  };
}

async function svgImageFromHtml(html: string, width: number, height: number): Promise<HTMLImageElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

export interface HtmlReportToPdfOptions {
  orientation?: 'portrait' | 'landscape';
  renderWidth?: number;
}

/**
 * Renders a full report HTML document to an actual PDF file and downloads it
 * directly — no print dialog. Measures the report off-screen at full size,
 * rasterizes it, then slices the resulting image across as many pages as it
 * needs and saves.
 */
export async function renderHtmlReportToPdf(
  reportHtml: string,
  filename: string,
  options: HtmlReportToPdfOptions = {},
): Promise<void> {
  if (typeof document === 'undefined') return;
  const { orientation = 'portrait', renderWidth = orientation === 'landscape' ? 1080 : 800 } = options;
  const { styles, sheetHtml } = extractReportFragment(reportHtml);

  // Measure real layout height first — the SVG needs explicit width/height
  // up front, and foreignObject content doesn't reflow after the fact.
  const measurer = document.createElement('div');
  measurer.style.cssText = `position:absolute;left:-9999px;top:0;width:${renderWidth}px;background:#fff;`;
  measurer.innerHTML = `<style>${styles}</style>${sheetHtml}`;
  document.body.appendChild(measurer);
  const renderHeight = measurer.scrollHeight;
  measurer.remove();

  const scale = 2;
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

  // Dynamically imported so jsPDF only loads into a device's bundle when a
  // PDF export is actually triggered.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

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
