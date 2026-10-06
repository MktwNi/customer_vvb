export interface GasSim {
  post(body: unknown): Record<string, unknown> & { ok: boolean; seq?: number; rows?: { seq: number; k: string; v: unknown; del: boolean; by: string; at: string }[]; more?: boolean; error?: string; n?: number };
  get(): Record<string, unknown>;
  sheet(): { rows: string[][]; getLastRow(): number } | undefined;
  props: Record<string, string>;
}
export function createGasSim(opts?: { teamKey?: string; code?: string }): GasSim;
