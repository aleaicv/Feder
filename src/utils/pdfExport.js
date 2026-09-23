import { parseBibTex } from '../components/Preview.jsx';
import katexCss from 'katex/dist/katex.min.css?inline';
import { resolveImageFile, arrayBufferToDataUrl, getMimeType } from './imageResolver';

/**
 * Preload all local images referenced in markdown into base64 Data URLs.
 * Resolves images from document directory, root, figures/ folder, or anywhere in the project.
 * This guarantees images are synchronously available when generating the PDF,
 * preventing broken images, CORS issues, or rendering delays.
 */
export async function preloadFigures(content, dirHandle, filePath = '', projectMetadata = null) {
    if (!content || !dirHandle) return content;

    let updatedContent = content;

    // Collect all unique image sources to preload
    const sourcesToResolve = new Set();

    const cleanSourceCandidate = (src) => {
        if (!src) return '';
        let s = src.trim().replace(/^<|>$/g, '').replace(/^["']|["']$/g, '');
        const titleMatch = s.match(/^(\S+)\s+["'].*["']$/);
        if (titleMatch) s = titleMatch[1];
        return s;
    };

    // 1. Matches Markdown image syntax: ![alt](src)
    const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
    for (const match of content.matchAll(imgRegex)) {
        const rawSrc = match[2]?.trim();
        const cleaned = cleanSourceCandidate(rawSrc);
        if (cleaned && !cleaned.startsWith('http://') && !cleaned.startsWith('https://') && !cleaned.startsWith('data:') && !cleaned.startsWith('blob:')) {
            sourcesToResolve.add(rawSrc);
            sourcesToResolve.add(cleaned);
        }
    }

    // 2. Matches HTML <img> tags: <img ... src="..." ...>
    const htmlImgRegex = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>/gi;
    for (const match of content.matchAll(htmlImgRegex)) {
        const rawSrc = match[1]?.trim();
        const cleaned = cleanSourceCandidate(rawSrc);
        if (cleaned && !cleaned.startsWith('http://') && !cleaned.startsWith('https://') && !cleaned.startsWith('data:') && !cleaned.startsWith('blob:')) {
            sourcesToResolve.add(rawSrc);
            sourcesToResolve.add(cleaned);
        }
    }

    // Resolve each unique source to data URL
    const srcToDataUrl = new Map();
    for (const rawSrc of sourcesToResolve) {
        try {
            const cleanSrc = cleanSourceCandidate(decodeURIComponent(rawSrc.trim()));
            const resolved = await resolveImageFile(cleanSrc, dirHandle, filePath, projectMetadata);
            if (resolved?.buffer && resolved.buffer.byteLength > 0) {
                const dataUrl = arrayBufferToDataUrl(resolved.buffer, resolved.mimeType);
                if (dataUrl) {
                    srcToDataUrl.set(rawSrc, dataUrl);
                    srcToDataUrl.set(cleanSrc, dataUrl);
                    srcToDataUrl.set(rawSrc.replace(/\\/g, '/'), dataUrl);
                    srcToDataUrl.set(cleanSrc.replace(/\\/g, '/'), dataUrl);
                    srcToDataUrl.set(rawSrc.replace(/\//g, '\\'), dataUrl);
                    srcToDataUrl.set(cleanSrc.replace(/\//g, '\\'), dataUrl);
                }
            } else {
                console.warn(`[pdfExport] Image not found in project: "${rawSrc}" (doc: "${filePath}")`);
            }
        } catch (err) {
            console.warn(`[pdfExport] Error preloading image: "${rawSrc}"`, err);
        }
    }

    // Replace Markdown images reliably
    updatedContent = updatedContent.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
        const trimmed = src.trim();
        const tMatch = trimmed.match(/^(\S+)\s+(["'].*["'])$/);
        const urlPart = tMatch ? tMatch[1] : trimmed;
        const titlePart = tMatch ? ` ${tMatch[2]}` : '';

        const dataUrl = srcToDataUrl.get(urlPart) 
            || srcToDataUrl.get(decodeURIComponent(urlPart))
            || srcToDataUrl.get(urlPart.replace(/\\/g, '/'))
            || srcToDataUrl.get(cleanSourceCandidate(urlPart));

        if (dataUrl) {
            return `![${alt}](${dataUrl}${titlePart})`;
        }
        return match;
    });

    // Replace HTML <img> tags reliably
    updatedContent = updatedContent.replace(/<img(\s+[^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, src, after) => {
        const trimmed = src.trim();
        const cleaned = cleanSourceCandidate(trimmed);
        const dataUrl = srcToDataUrl.get(trimmed) 
            || srcToDataUrl.get(cleaned)
            || srcToDataUrl.get(decodeURIComponent(trimmed))
            || srcToDataUrl.get(trimmed.replace(/\\/g, '/'));

        if (dataUrl) {
            return `<img${before}src="${dataUrl}"${after}>`;
        }
        return match;
    });

    return updatedContent;
}

/**
 * Preloads and parses bibliography from references.bib
 */
export async function preloadBibData(metadata, dirHandle) {
    if (!dirHandle || metadata?.useReferences === false) {
        return {};
    }

    try {
        const bibFilename = metadata?.referencesFile || 'references.bib';
        let referencesDirHandle;
        try {
            referencesDirHandle = await dirHandle.getDirectoryHandle('references');
        } catch (err) {
            referencesDirHandle = dirHandle;
        }

        const parts = bibFilename.split('/').filter(Boolean);
        let currentHandle = referencesDirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            if (parts[i] === 'references' && i === 0) continue;
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        }
        const filename = parts[parts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const text = await file.text();
        return parseBibTex(text);
    } catch (e) {
        console.warn('[pdfExport] Could not preload bibliography:', e);
        return {};
    }
}

/**
 * Dedicated high-contrast Black & White print styles for clean, professional PDF export.
 */
const PRINT_STYLES = `
    @page {
        size: A4 portrait;
        margin: 20mm 15mm 20mm 15mm;
    }

    @media print, all {
        *, *::before, *::after {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        html, body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            font-size: 11pt;
            line-height: 1.6;
        }

        .feder-print-document {
            width: 100%;
            max-width: 100%;
            margin: 0 auto;
            background: #ffffff !important;
            color: #000000 !important;
        }

        /* Pure Black & White typography */
        h1, h2, h3, h4, h5, h6, p, span, li, dt, dd, blockquote, figcaption, strong, b, em, i, th, td {
            color: #000000 !important;
        }

        /* Headings */
        h1, h2, h3, h4, h5, h6 {
            font-weight: 700 !important;
            page-break-after: avoid;
            break-after: avoid;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            line-height: 1.25;
        }

        h1.section-h1-title, h1.preview-title, h1.eng-report-title, h1.script-title, h1.scholar-lecture-title, h1.journal-title {
            font-size: 20pt !important;
            color: #000000 !important;
            border-bottom: 1.5pt solid #000000 !important;
            padding-bottom: 6pt !important;
            margin-top: 1.5em !important;
            margin-bottom: 0.8em !important;
        }

        h2 { font-size: 15pt !important; border-bottom: 0.5pt solid #cccccc; padding-bottom: 3pt; }
        h3 { font-size: 12.5pt !important; }
        h4 { font-size: 11pt !important; }

        p {
            margin: 0 0 1em 0;
            orphans: 3;
            widows: 3;
            text-align: justify;
        }

        ul, ol {
            margin: 0 0 1em 1.5em;
            padding: 0;
        }

        li {
            margin-bottom: 0.35em;
        }

        /* Links & Cross-References */
        a, a:visited {
            color: #000000 !important;
            text-decoration: underline;
        }

        .cross-ref-link, a.cross-ref-link {
            color: #000000 !important;
            text-decoration: none !important;
            font-weight: 600 !important;
            border-bottom: 0.75pt solid #333333;
        }

        /* Figures & Images */
        figure {
            display: block !important;
            margin: 18pt auto !important;
            text-align: center !important;
            width: 100% !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        figure img, img {
            display: block !important;
            margin: 0 auto !important;
            max-width: 100% !important;
            height: auto !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border-radius: 4px;
        }

        figcaption {
            display: block !important;
            margin-top: 7pt !important;
            font-size: 9.5pt !important;
            color: #222222 !important;
            font-style: italic !important;
            line-height: 1.4;
        }

        figcaption strong {
            font-weight: 700 !important;
            color: #000000 !important;
            font-style: normal;
        }

        /* Tables */
        .table-container {
            width: 100% !important;
            margin: 18pt 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .table-container.center-table table {
            margin-left: auto !important;
            margin-right: auto !important;
        }

        .table-container.left-table table {
            margin-left: 0 !important;
            margin-right: auto !important;
        }

        .table-caption {
            font-size: 10pt !important;
            font-weight: 500 !important;
            color: #000000 !important;
            margin: 12pt 0 6pt 0 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
        }

        .table-caption strong {
            font-weight: 700 !important;
            color: #000000 !important;
        }

        table {
            border-collapse: collapse !important;
            width: 95% !important;
            max-width: 100% !important;
            margin: 8pt auto !important;
            border: 1pt solid #000000 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        th, td {
            border: 1pt solid #000000 !important;
            padding: 7pt 12pt !important;
            font-size: 9.5pt !important;
            color: #000000 !important;
            background: transparent !important;
            vertical-align: top;
        }

        th {
            font-weight: 700 !important;
            background-color: #f2f2f2 !important;
            border-bottom: 2pt solid #000000 !important;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            font-size: 8.5pt !important;
        }

        .table-container.no-borders table,
        .table-container.no-borders th,
        .table-container.no-borders td {
            border: none !important;
        }

        .table-container.center-text-table th,
        .table-container.center-text-table td {
            text-align: center !important;
        }

        /* Equations (KaTeX) */
        .labeled-equation, .katex-display {
            display: block !important;
            margin: 16pt 0 !important;
            text-align: center !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .labeled-equation.align-left, .katex-display.align-left {
            text-align: left !important;
            padding-left: 1.5em;
        }

        .katex {
            color: #000000 !important;
            font-size: 1.15em !important;
        }

        .katex-html {
            color: #000000 !important;
        }

        .katex-display > .katex > .katex-html > .tag {
            color: #000000 !important;
            font-weight: 600;
        }

        /* Blockquotes & Highlighted Blocks */
        blockquote, .highlighted-block {
            border-left: 3pt solid #000000 !important;
            padding: 6pt 14pt !important;
            margin: 14pt 0 !important;
            background-color: #f9f9f9 !important;
            font-style: italic;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .highlighted-block {
            font-style: normal;
        }

        /* Code & Preformatted */
        pre, code {
            font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace !important;
            font-size: 9.5pt !important;
            background-color: #f5f5f5 !important;
            color: #000000 !important;
        }

        pre {
            padding: 10pt !important;
            border: 1pt solid #cccccc !important;
            border-radius: 4px;
            overflow-x: auto;
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        code:not(pre code) {
            padding: 2pt 4pt;
            border-radius: 3px;
            border: 0.5pt solid #dddddd;
        }

        /* Checkboxes / Task lists */
        input[type="checkbox"] {
            margin-right: 6pt;
            accent-color: #000000;
            vertical-align: middle;
        }

        /* Header / Cover Pages */
        .preview-header {
            margin-bottom: 24pt !important;
            border-bottom: 2pt solid #000000 !important;
            padding-bottom: 14pt !important;
        }

        .preview-subtitle {
            font-size: 12pt !important;
            color: #333333 !important;
            font-style: italic;
            margin-bottom: 10pt;
        }

        .preview-authors, .paper-authors-block, .eng-team-section {
            font-size: 10.5pt !important;
            font-weight: 600 !important;
            margin-bottom: 14pt;
        }

        .preview-abstract, .eng-summary-block {
            background-color: #f8f8f8 !important;
            border-left: 3pt solid #000000 !important;
            padding: 10pt 14pt !important;
            margin: 14pt 0 !important;
            font-size: 10pt !important;
        }

        .preview-abstract-label {
            font-weight: 700;
            text-transform: uppercase;
            font-size: 8.5pt;
            letter-spacing: 0.05em;
            margin-bottom: 4pt;
        }

        /* Engineer Mode Cover */
        .eng-cover-page {
            border: 2pt solid #000000;
            padding: 24pt;
            margin-bottom: 30pt;
            page-break-after: always;
        }

        .eng-meta-grid, .eng-approval-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12pt;
            border: 1pt solid #000000;
            padding: 10pt;
            margin: 14pt 0;
        }

        .eng-approval-grid {
            grid-template-columns: repeat(2, 1fr);
        }

        .eng-meta-item .label, .approval-col .label, .eng-client-block .label {
            font-weight: 700;
            font-size: 8pt;
            text-transform: uppercase;
            color: #444444 !important;
            display: block;
        }

        .signature-line {
            display: block;
            border-bottom: 1pt solid #000000;
            margin: 20pt 0 6pt 0;
        }

        /* Scholar Mode Cover */
        .scholar-cover-page {
            border: 1.5pt solid #000000;
            padding: 20pt;
            margin-bottom: 24pt;
            border-radius: 6px;
        }

        .scholar-course-tag {
            font-weight: 700;
            font-size: 9pt;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1pt solid #000000;
            padding-bottom: 4pt;
            margin-bottom: 12pt;
        }

        /* Journalist Mode Header */
        .journal-header {
            border-bottom: 2pt solid #000000;
            padding-bottom: 14pt;
            margin-bottom: 20pt;
        }

        .journal-meta-top {
            display: flex;
            justify-content: space-between;
            font-size: 8.5pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1pt solid #000000;
            padding-bottom: 4pt;
            margin-bottom: 12pt;
        }

        /* Scriptwriter Mode Cover */
        .script-cover-page {
            text-align: center;
            padding: 60pt 20pt;
            margin-bottom: 30pt;
            page-break-after: always;
        }

        /* Table of Contents */
        .toc-block {
            margin: 20pt 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }

        .toc-item {
            display: flex;
            justify-content: space-between;
            border-bottom: 1pt dotted #888888 !important;
            padding: 3pt 0 !important;
            margin-bottom: 6pt !important;
        }

        /* References Section */
        .references-section {
            margin-top: 30pt !important;
            padding-top: 14pt !important;
            border-top: 1.5pt solid #000000 !important;
            page-break-before: auto;
        }

        .references-section h1 {
            border-bottom: none !important;
            font-size: 16pt !important;
            margin-top: 0 !important;
        }

        .references-list div {
            font-size: 9.5pt !important;
            line-height: 1.5 !important;
            margin-bottom: 10pt !important;
        }

        /* Hide screen-only interactive UI controls */
        button,
        .btn-icon,
        .section-collapsible-trigger svg,
        .preview-tabs-header,
        .document-link-icon {
            display: none !important;
        }
    }
`;

/**
 * Builds a clean, standalone, self-contained HTML document string with inlined KaTeX CSS
 * and the Black & White print stylesheet.
 */
export function buildPrintHtmlDocument(renderedHtml, title = 'Document') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
    <style>
        /* KaTeX styles */
        ${katexCss}

        /* Dedicated Black & White Print Styles */
        ${PRINT_STYLES}
    </style>
</head>
<body class="feder-print-body">
    <div class="feder-print-document">
        ${renderedHtml}
    </div>
</body>
</html>`;
}

/**
 * Executes the PDF export:
 * - If running in Electron: uses native Chromium printToPDF with a Save Dialog.
 * - If running in Browser: writes to an isolated hidden iframe and opens browser print preview.
 */
export async function executePdfExport(fullHtml, defaultFilename = 'export.pdf') {
    // 1. Electron Environment
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.exportPdf === 'function') {
        try {
            const res = await window.electronAPI.exportPdf({
                html: fullHtml,
                defaultFilename
            });
            return res; // { success: true, filePath } or { canceled: true }
        } catch (err) {
            console.error('[pdfExport] Electron export failed, falling back to iframe print', err);
        }
    }

    // 2. Web Browser Environment (or fallback)
    return new Promise((resolve) => {
        let iframe = document.getElementById('feder-print-iframe');
        if (iframe) iframe.remove();

        iframe = document.createElement('iframe');
        iframe.id = 'feder-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.top = '-9999px';
        iframe.style.left = '-9999px';
        iframe.style.width = '1000px';
        iframe.style.height = '1000px';
        iframe.style.border = 'none';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(fullHtml);
        iframeDoc.close();

        const triggerPrint = () => {
            setTimeout(() => {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                    resolve({ success: true, webPrint: true });
                } catch (e) {
                    console.error('[pdfExport] Web print failed:', e);
                    resolve({ error: e });
                } finally {
                    setTimeout(() => {
                        iframe.remove();
                    }, 2000);
                }
            }, 300);
        };

        if (iframeDoc.readyState === 'complete') {
            triggerPrint();
        } else {
            iframe.onload = triggerPrint;
        }
    });
}
