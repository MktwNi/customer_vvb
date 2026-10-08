import 'react';

// the hover system's custom properties (index.css), set inline where a control's resting colour varies
declare module 'react' {
  interface CSSProperties {
    '--bg'?: string;
    '--hv'?: string;
    '--bd'?: string;
    // the tracker's stage circles: how many stages share the track (their size follows)
    '--n'?: number;
    // the guide line under an open deal's chevron: brand once a stage is reached
    '--line-c'?: string;
  }
}
