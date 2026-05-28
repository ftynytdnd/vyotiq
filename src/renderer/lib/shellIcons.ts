/**

 * Vyotiq UI Lucide scale — aligned with `.ui-mockup` kit.tsx and tab bodies.

 *

 * | Role              | Tailwind     | px  | stroke |

 * |-------------------|--------------|-----|--------|

 * | Tab / dock tab    | h-4 w-4      | 16  | 1.75   |

 * | Chrome control    | h-4 w-4      | 16  | 1.75   |

 * | Row action button | h-3.5 w-3.5  | 14  | 2.0    |

 * | Micro affordance  | h-2.5 w-2.5  | 10  | 2.0    |

 *

 * `index.css` enforces matching min sizes on `.vx-tab` / `.vx-dock-tab`

 * and composer / window chrome so glyphs do not shrink in flex layouts.

 */



/** Underline tab strip (settings, checkpoints, context inspector). */

export const SHELL_TAB_ICON_CLASS = 'h-4 w-4 shrink-0 opacity-80';

export const SHELL_TAB_ICON_STROKE = 1.75;



/** Dock tab rows and dock footer toolbar. */

export const SHELL_DOCK_TAB_ICON_CLASS = 'h-4 w-4 shrink-0 opacity-80';



/** Square h-6 chrome: titlebar, composer toolbar, panel close. */

export const SHELL_CHROME_ICON_CLASS = 'h-4 w-4 shrink-0';

export const SHELL_CHROME_ICON_STROKE = 1.75;



/** Window tray — heavier stroke for small glyphs on glass chrome. */

export const SHELL_WINDOW_ICON_STROKE = 2.25;



/** `vx-btn-quiet` / row actions (discover, reset, provider actions). */

export const SHELL_ROW_ICON_CLASS = 'h-3.5 w-3.5 shrink-0';

export const SHELL_ROW_ICON_STROKE = 2;



/** Inline chevrons and dense row affordances. */

export const SHELL_COMPACT_ICON_CLASS = 'h-3.5 w-3.5 shrink-0';

export const SHELL_COMPACT_ICON_STROKE = 2;



/** Copy, chevron, undo, and other inline row actions — balanced readability. */

export const SHELL_ACTION_ICON_STROKE = 2;



/** Send stop, chip dismiss, and other micro affordances. */

export const SHELL_MICRO_ICON_CLASS = 'h-2.5 w-2.5 shrink-0';

export const SHELL_MICRO_ICON_STROKE = 2;


