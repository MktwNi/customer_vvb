import 'react';

// the hover system's custom properties (index.css), set inline where a control's resting colour varies
declare module 'react' {
  interface CSSProperties {
    '--bg'?: string;
    '--hv'?: string;
    '--bd'?: string;
  }
}
