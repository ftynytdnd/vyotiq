/** Instant pin — avoids smooth `scrollIntoView` fighting growing stream content. */
export function pinScrollParentToTail(parent: HTMLElement): void {
  const maxScroll = parent.scrollHeight - parent.clientHeight;
  if (parent.scrollTop !== maxScroll) {
    parent.scrollTop = maxScroll;
  }
}
