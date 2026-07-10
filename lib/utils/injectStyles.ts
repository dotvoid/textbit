if (typeof document !== 'undefined') {
  const id = 'textbit-keyframes'

  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id

    /**
     * Block caret blinking animation
     */

    /**
     * Focus ring shown on block/void elements when the cursor is inside them.
     * Hides automatically when the block caret (adjacent navigation) is active.
     *
     * Customisable via CSS custom properties:
     *   --tb-focus-ring-radius  Border radius of the ring (default: 2px)
     *
     * Example:
     *   .my-editor { --tb-focus-ring-radius: 6px; }
     */
    style.textContent = [
      `@keyframes block-caret-blink{0%,100%{opacity:1}50%{opacity:0}}`,
      `[data-state="active"] .tb-focus-ring{outline:1px solid currentColor;outline-offset:4px;border-radius:var(--tb-focus-ring-radius,5px);opacity:0.3}`,
      /**
       * Visual marker for non-breaking spaces (U+00A0). The character is
       * invisible in the DOM, so we tint its leaf and outline it so authors
       * can spot intentional NBSPs. Colours are derived from `currentColor`
       * via `color-mix`, so the marker adapts to light and dark themes
       * without any consumer setup.
       *
       * Customisable via CSS custom properties:
       *   --tb-nbsp-background  Background of an NBSP leaf
       *   --tb-nbsp-border      Border/outline of the leaf (any box-shadow value; `none` to remove)
       *   --tb-nbsp-radius      Corner radius of the tint (default: 2px)
       */
      `.tb-nbsp{background:var(--tb-nbsp-background,color-mix(in srgb,currentColor 18%,transparent));box-shadow:var(--tb-nbsp-border,inset 0 0 0 1px color-mix(in srgb,currentColor 35%,transparent));border-radius:var(--tb-nbsp-radius,2px)}`
    ].join('')

    document.head.appendChild(style)
  }
}
