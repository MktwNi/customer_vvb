/**
 * The UAT copy of the site: the same code built with VITE_UAT=1 and served at …/uat/ next to the real
 * site, so the team tries what is new on the real web before it ships (.github/workflows/deploy-pages.yml).
 *
 * It shares the origin (mktwni.github.io) with the real site, so everything this browser keeps for it —
 * localStorage keys, the IndexedDB database, Web Lock names, the one-tab sessionStorage link — gets a name
 * of its own: testing never reads, overwrites or syncs what the real site keeps. Its team is its own too
 * (VITE_TEAM_URL at build: a UAT team script, or none: this browser only). On the real site nothing changes.
 */
export const UAT = String(import.meta.env?.VITE_UAT ?? '') === '1';

/** A storage or lock name for one copy of the site: unchanged on the real site, prefixed on UAT. */
export const nsWith = (uat: boolean, name: string) => (uat ? 'uat:' + name : name);

/** A storage or lock name for this copy of the site. */
export const ns = (name: string) => nsWith(UAT, name);
