// Life OS — Swipe Gesture Handler
// Rule: Swipe LEFT = delete/remove, Swipe RIGHT = secondary action (context-dependent)
// Usage: initSwipe(element, onLeft, onRight, threshold=60)

export function initSwipe(el, onLeft, onRight, threshold = 60) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let isDragging = false;
  let startTime = 0;

  const inner = el.querySelector('[data-swipe-inner]') || el;

  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    currentX = 0;
    isDragging = false;
    startTime = Date.now();
    inner.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Only activate swipe if horizontal motion is dominant
    if (!isDragging && Math.abs(dx) < Math.abs(dy) * 1.2) return;
    isDragging = true;

    currentX = dx;
    // Visual feedback: translate and color shift
    inner.style.transform = `translateX(${dx}px)`;
    if (dx < -20) {
      el.style.background = '#FEE2E2'; // red tint = delete
    } else if (dx > 20) {
      el.style.background = '#D1FAE5'; // green tint = action
    } else {
      el.style.background = '';
    }
  }, { passive: true });

  el.addEventListener('touchend', () => {
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(currentX) / elapsed;

    // Reset visual
    inner.style.transition = 'transform 0.25s ease';
    inner.style.transform = 'translateX(0)';
    el.style.background = '';

    if (!isDragging) return;

    if (currentX < -threshold || (currentX < -30 && velocity > 0.5)) {
      // Swipe LEFT = delete
      if (onLeft) {
        el.style.transition = 'opacity 0.3s, transform 0.3s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(-100%)';
        setTimeout(() => onLeft(), 300);
      }
    } else if (currentX > threshold || (currentX > 30 && velocity > 0.5)) {
      // Swipe RIGHT = action
      if (onRight) {
        el.style.transition = 'opacity 0.3s, transform 0.3s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(100%)';
        setTimeout(() => onRight(), 300);
      }
    }

    isDragging = false;
    currentX = 0;
  }, { passive: true });
}

/** Apply swipe to all matching children inside a container */
export function initSwipeList(container, selector, getCallbacks) {
  const items = container.querySelectorAll(selector);
  items.forEach(item => {
    const id = item.dataset.id;
    const { onLeft, onRight } = getCallbacks(id, item);
    initSwipe(item, onLeft, onRight);
  });
}
