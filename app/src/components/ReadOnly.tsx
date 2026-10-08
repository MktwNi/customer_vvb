import type { CSSProperties, ReactNode } from 'react';

const reset: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

/** Everything inside can't be changed by an account that can only read (`ro`): a fieldset disables
 *  every field and button in it at once. Looks like a plain block. */
export function ReadOnly({ ro, children, style }: { ro: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <fieldset disabled={ro} style={{ ...reset, ...style }}>
      {children}
    </fieldset>
  );
}
