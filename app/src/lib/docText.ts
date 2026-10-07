// PLACEHOLDER — replaced by the full implementation from branch wf/doc-extract (same signatures).
export interface DocText { text: string; method: 'pdf-text' | 'ocr' | 'none'; pages: number }
export async function readDocText(file: Blob & { name?: string; type: string }, opts?: { onProgress?: (msg: string, pct?: number) => void; signal?: AbortSignal }): Promise<DocText> {
  void file;
  void opts;
  return { text: '', method: 'none', pages: 0 };
}
