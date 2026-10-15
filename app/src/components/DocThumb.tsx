import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { DealDoc } from '../lib/sales';

/** Thumbnails made this session (doc id → data URL): the panel re-renders often. */
const thumbs = new Map<string, string>();
/** A small picture of the document (its first page, or the image) that opens the file, so the figure can
 *  be checked by eye. Made from this browser's copy only (never a Drive download for a picture): until
 *  the file has been opened here it says what it is. `tick` changes after the file is opened. */
export function DocThumb({ doc, tick, onOpen }: { doc: DealDoc; tick: number; onOpen: () => void }) {
  const { engine: e } = useApp();
  const [src, setSrc] = useState(thumbs.get(doc.id) || '');
  useEffect(() => {
    if (thumbs.has(doc.id)) return void setSrc(thumbs.get(doc.id)!);
    let live = true;
    (async () => {
      const blob = await e.docLocalBlob(doc);
      if (!blob) return;
      const { docThumb } = await import('../lib/docText');
      const url = await docThumb(blob);
      thumbs.set(doc.id, url);
      if (live) setSrc(url);
    })().catch(() => {}); // HEIC, a damaged file: the word stays
    return () => {
      live = false;
    };
  }, [doc.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" className="sl-thumb hv" onClick={onOpen} title={'เปิดไฟล์ ' + doc.name} aria-label={'เปิดไฟล์ ' + doc.name}>
      {src ? <img src={src} alt="" /> : <span>{doc.mime === 'application/pdf' ? 'PDF' : 'รูป'}</span>}
    </button>
  );
}
