"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { buttonClass } from "./button-class";
import { fileKind } from "./file-upload";
import { FileBadge } from "./FileUpload";
import { Note } from "./Note";
import { fitZoom, initialViewer, MAX_ZOOM, MIN_ZOOM, nextViewer, zoomLabel } from "./viewer-state";
import "./DocumentViewer.css";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjs: Promise<Pdfjs> | null = null;

/**
 * pdf.js (Apache-2.0, ADR-0053's self-hosting): the library and its worker from the same `pdfjs-dist` install, bundled
 * with the app and served from its own origin, never a CDN. Loaded on the first Viewer only, in the browser.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return lib;
  });
  return pdfjs;
}

/** A page's role, when it is named: a picture of the page. */
const PICTURE = "img";
/** No page read yet. */
const NO_WIDTHS: number[] = [];
/** A thumbnail's width, in CSS pixels. */
const THUMB_WIDTH = 72;
/** The pages' padding, each side, in CSS pixels (DocumentViewer.css). */
const PAGES_PADDING = 24;

/**
 * The Design System's PDF / DOCX Viewer (#468): a toolbar (the file, « Page x sur y », zoom − and +, « Ajuster »,
 * « Télécharger »), the pages' thumbnails, and the pages drawn as paper, read by pdf.js. A Word document is shown from
 * the PDF the export draws from the same content, so the preview has the export's layout; the page offers the Word
 * file beside it. « Télécharger » gives the very file shown (`download` when it is served from another address).
 * `aside` goes under the toolbar's end, for a page's own words (« Aperçu de l'export »).
 */
export function DocumentViewer({
  src,
  fileName,
  download,
  aside,
}: {
  /** The PDF's address, same origin. */
  src: string;
  fileName: string;
  download?: { href: string; fileName: string };
  aside?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(nextViewer, initialViewer);
  /** The file read, for the address it was read from: another `src` shows nothing until it is read in turn. */
  const [read, setRead] = useState<{ src: string; pdf: PDFDocumentProxy; widths: number[]; file: string } | { src: string; failed: true } | null>(null);
  const pdf = read?.src === src && "pdf" in read ? read.pdf : null;
  const failed = read?.src === src && "failed" in read;
  /** Each page's width at 100 %, in CSS pixels (a PDF point is a CSS pixel at 100 %). */
  const widths = read?.src === src && "widths" in read ? read.widths : NO_WIDTHS;
  const pages = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let file: string | null = null;
    // The bytes are read once: drawn, and kept for « Télécharger », which so gives the very file shown (an export
    // drawn again would differ, by its date at least).
    Promise.all([loadPdfjs(), fetch(src).then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))])
      .then(([lib, bytes]) => {
        if (cancelled) return null;
        file = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        // pdf.js takes the bytes it is given to its worker: a copy, so the Blob keeps its own.
        task = lib.getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: true });
        return task.promise;
      })
      .then(async (document) => {
        if (!document || cancelled || !file) return;
        const sizes = await Promise.all(Array.from({ length: document.numPages }, (_, i) => document.getPage(i + 1).then((page) => page.getViewport({ scale: 1 }).width)));
        if (cancelled) return;
        setRead({ src, pdf: document, widths: sizes, file });
        dispatch({ type: "loaded", pages: document.numPages });
        // A column narrower than the page at 100 %: the page opens fitted to it, never wider than the space.
        const room = pages.current ? pages.current.clientWidth - 2 * PAGES_PADDING : Infinity;
        const fitted = fitZoom({ pageWidth: Math.max(...sizes), available: room });
        if (fitted < 100) dispatch({ type: "fit", zoom: fitted });
      })
      .catch(() => {
        if (!cancelled) setRead({ src, failed: true });
      });
    return () => {
      cancelled = true;
      void task?.destroy();
      if (file) URL.revokeObjectURL(file);
    };
  }, [src]);

  // The page in view: the last whose top has passed the middle of the first screenful.
  const follow = useCallback(() => {
    const container = pages.current;
    if (!container) return;
    const mark = container.scrollTop + container.clientHeight / 3;
    let inView = 1;
    container.querySelectorAll<HTMLElement>("[data-page]").forEach((element) => {
      if (element.offsetTop <= mark) inView = Number(element.dataset.page);
    });
    dispatch({ type: "page", page: inView });
  }, []);

  const show = useCallback((page: number) => {
    const container = pages.current;
    const element = container?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (container && element) container.scrollTop = element.offsetTop - PAGES_PADDING;
    dispatch({ type: "page", page });
  }, []);

  const choose = useCallback((event: MouseEvent<HTMLButtonElement>) => show(Number(event.currentTarget.dataset.thumb)), [show]);

  const fit = useCallback(() => {
    const container = pages.current;
    const widest = Math.max(...widths);
    if (!container || !Number.isFinite(widest)) return;
    dispatch({ type: "fit", zoom: fitZoom({ pageWidth: widest, available: container.clientWidth - 2 * PAGES_PADDING }) });
  }, [widths]);

  // Until the file is read, « Télécharger » fetches it from its address.
  const shownFile = read?.src === src && "file" in read ? read.file : src;
  const file = download ?? { href: shownFile, fileName };
  return (
    <section className="ds-viewer" aria-label={fileName}>
      <div className="ds-viewer__bar" role="toolbar" aria-label={t("designSystem.viewer.toolbar")}>
        <span className="ds-viewer__name">
          <FileBadge kind={fileKind(fileName)} small />
          <span>{fileName}</span>
        </span>
        <span className="ds-viewer__spacer" />
        {aside ? <span className="ds-viewer__aside">{aside}</span> : null}
        <span className="ds-viewer__count" data-viewer-page>
          {state.pages > 0 ? t("designSystem.viewer.pageOf", { page: state.page, pages: state.pages }) : null}
        </span>
        <span className="ds-viewer__zoom">
          <button type="button" aria-label={t("designSystem.viewer.zoomOut")} disabled={!pdf || state.zoom <= MIN_ZOOM} onClick={() => dispatch({ type: "zoomOut" })}>
            <Icons.minus />
          </button>
          <span data-viewer-zoom>{zoomLabel(state.zoom, i18n.language)}</span>
          <button type="button" aria-label={t("designSystem.viewer.zoomIn")} disabled={!pdf || state.zoom >= MAX_ZOOM} onClick={() => dispatch({ type: "zoomIn" })}>
            <Icons.add />
          </button>
        </span>
        <button className={buttonClass({ size: "sm" })} type="button" disabled={!pdf} onClick={fit}>
          {t("designSystem.viewer.fit")}
        </button>
        <a className={buttonClass({ size: "sm" })} href={file.href} download={file.fileName}>
          <Icons.download />
          {t("designSystem.viewer.download")}
        </a>
      </div>
      {failed ? (
        <div className="ds-viewer__failed">
          <Note tone="danger" role="alert">
            {t("designSystem.viewer.failed")}
          </Note>
        </div>
      ) : (
        <div className="ds-viewer__stage" aria-busy={!pdf || undefined}>
          <nav className="ds-viewer__thumbs" aria-label={t("designSystem.viewer.pages")}>
            {pdf
              ? Array.from({ length: state.pages }, (_, i) => i + 1).map((page) => (
                  <button key={page} type="button" aria-current={page === state.page ? "page" : undefined} aria-label={t("designSystem.viewer.page", { page })} data-thumb={page} onClick={choose}>
                    <PageCanvas pdf={pdf} page={page} width={THUMB_WIDTH} />
                    <span aria-hidden>{page}</span>
                  </button>
                ))
              : null}
          </nav>
          <div className="ds-viewer__pages" ref={pages} onScroll={follow} tabIndex={0} aria-label={t("designSystem.viewer.pages")} role="region">
            {pdf ? (
              widths.map((width, i) => (
                <div key={i} className="ds-viewer__paper" data-page={i + 1}>
                  <PageCanvas pdf={pdf} page={i + 1} width={(width * state.zoom) / 100} label={t("designSystem.viewer.pageOf", { page: i + 1, pages: state.pages })} />
                </div>
              ))
            ) : (
              <p className="ds-viewer__loading">{t("designSystem.viewer.loading")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** One page of the PDF drawn on a canvas `width` CSS pixels wide, sharp on a dense screen. A picture named by `label`. */
function PageCanvas({ pdf, page, width, label }: { pdf: PDFDocumentProxy; page: number; width: number; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    void pdf.getPage(page).then((proxy) => {
      const target = canvas.current;
      if (cancelled || !target) return;
      const scale = width / proxy.getViewport({ scale: 1 }).width;
      const viewport = proxy.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      setHeight(viewport.height / (window.devicePixelRatio || 1));
      task = proxy.render({ canvas: target, viewport });
      task.promise.catch(() => {
        // Cancelled by a newer zoom: that one draws the page.
      });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width]);
  return (
    <canvas
      ref={canvas}
      className="ds-viewer__canvas"
      style={{ width, height: height ?? undefined }}
      role={label ? PICTURE : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
