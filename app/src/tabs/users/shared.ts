/**
 * What the sections of ผู้ใช้และสิทธิ์ share: the admin's directory (TeamDir: accounts, roles, extras,
 * requests, the audit trail) and the questions they ask of it. Pure (tests read them).
 */
import type { TeamDir, TeamUser } from '../../lib/engine';
import { BUILTIN, isBuiltin, live, type RoleDef } from '../../lib/caps';

export const isOn = (u: Pick<TeamUser, 'on'>) => u.on === 1 || u.on === true;
/** The role with this id (a role deleted meanwhile: its id, no capabilities). */
export const roleOf = (roles: RoleDef[], id: string): RoleDef => roles.find((r) => r.id === id) || (isBuiltin(id) ? BUILTIN[id] : { id, n: id, d: '', c: {} });
/** The accounts whose role (as stored, not a temporary one) is `rid`. */
export const membersOf = (dir: Pick<TeamDir, 'users'>, rid: string) => dir.users.filter((u) => u.role === rid);
/** The role an account works under today: a temporary role while it lasts, else its own. */
export const effRole = (dir: Pick<TeamDir, 'grants'>, u: Pick<TeamUser, 'u' | 'role'>, today: string) => {
  const r = dir.grants[u.u]?.r;
  // an admin stays one whatever GRANTS says (the script's capsOf_)
  return u.role !== 'admin' && r && r.id !== 'admin' && live(r.until, today) ? r.id : u.role;
};
/** The account's extras that still hold. */
export const extrasOf = (dir: Pick<TeamDir, 'grants'>, u: string, today: string) => (dir.grants[u]?.c || []).filter((x) => live(x.until, today));
/** "ใช้กับ 2 คน: เอก, มกร" */
export function peopleLine(dir: Pick<TeamDir, 'users'>, rid: string) {
  const m = membersOf(dir, rid);
  return m.length ? `ใช้กับ ${m.length} คน: ${m.map((u) => u.name).join(', ')}` : 'ยังไม่มีผู้ใช้';
}
/** Roles in the order the page lists them (built-ins first, then as the script ordered them). */
export const roleRank = (roles: RoleDef[]) => new Map(roles.map((r, i) => [r.id, i]));
/** The display name of a username (the user list), else the username. */
export const userName = (dir: Pick<TeamDir, 'users'>, u: string) => dir.users.find((x) => x.u === u)?.name || u;
/** An e-mail address as far as a form can tell. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
