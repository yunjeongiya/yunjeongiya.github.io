---
layout: post
title: "Marquee Selection Scroll Bug: 5 Failed Attempts to Learn How Coordinates Really Work"
date: 2025-11-09 17:00:00 +0900
categories: [Frontend, Debug]
tags: [javascript, css, scroll, coordinates, debugging]
lang: en
slug: "006-en"
---

## TL;DR
Marquee selection breaks when scrolling. Don't mix clientY with scrollTop. Use document coordinates from the start. With position: absolute, just use document coordinates directly - the browser handles the rest.

---

## The Bug: Marquee Selection Falls Apart When Scrolling

Building a multi-select feature for a task template list. You know, drag to draw a box and select everything inside - like selecting files in Windows Explorer.

But when scrolling while dragging, weird things happened:
- Marquee box didn't follow the scroll
- Selection area got disconnected
- Only items visible on screen got selected

Thought it'd be a quick fix. Took 5 complete rewrites. 😭

---

## Attempt 1: "Just Add the Scroll Offset, Right?"

First thought was simple. Just add the scroll amount:

```javascript
// Add scroll when calculating marquee area
const rect = {
  left: Math.min(startX, currentX) + scrollLeft,
  top: Math.min(startY, currentY) + scrollTop,
  // ...
};
```

Result: Marquee box still broken. Something fundamentally wrong here.

---

## Attempt 2: "Maybe Auto-scroll Will Fix It?"

Added auto-scrolling when mouse reaches container edges:

```javascript
const edgeThreshold = 50;
const scrollSpeed = 10;

if (mouseY < containerTop + edgeThreshold) {
  container.scrollBy(0, -scrollSpeed); // Scroll up
}
```

Auto-scroll worked great, but marquee box still broken. Starting point jumped around during scroll.

---

## Attempt 3: "Switch to Document Coordinates"

Finally realized I was mixing screen coordinates (clientX/Y) with document coordinates!

```javascript
// Save initial scroll position when starting marquee
startScrollX: container.scrollLeft,
startScrollY: container.scrollTop,

// Convert start point to document coordinates
startDocX: startX - containerLeft + startScrollX,
startDocY: startY - containerTop + startScrollY,

// Current point also in document coordinates
currentDocX: currentX - containerLeft + currentScrollLeft,
currentDocY: currentY - containerTop + currentScrollTop,
```

Selection worked now but... marquee box stuck to screen, didn't move with scroll?

---

## Attempt 4: "Clamp Mouse Position to Container"

Maybe the problem was mouse going outside container bounds?

```javascript
const clampedX = Math.max(containerLeft, Math.min(currentX, containerRight));
const clampedY = Math.max(containerTop, Math.min(currentY, containerBottom));
```

No effect. Problem was elsewhere.

---

## Attempt 5: "Wait... position: absolute Already Uses Document Coordinates"

The revelation:

```javascript
// Before: Trying to convert document coords to viewport
const style = {
  left: docX - currentScrollLeft,  // ❌ Why subtract?
  top: docY - currentScrollTop,     // ❌ Why?
};

// After: Just use document coordinates
const style = {
  left: docX,  // ✅ That's it!
  top: docY,   // ✅
};
```

**position: absolute inside a scroll container uses document coordinates directly!**

The browser automatically handles scroll positioning. I was overcomplicating it.

---

## The Final Solution

```javascript
// 1. Save initial scroll position on start
const startScrollX = container.scrollLeft;
const startScrollY = container.scrollTop;

// 2. Calculate everything in document coordinates
const startDocX = startX - containerRect.left + startScrollX;
const currentDocX = currentX - containerRect.left + currentScrollLeft;

// 3. Marquee box style uses document coords as-is
return {
  position: 'absolute',
  left: Math.min(startDocX, currentDocX),
  top: Math.min(startDocY, currentDocY),
  width: Math.abs(currentDocX - startDocX),
  height: Math.abs(currentDocY - startDocY),
};
```

That's all. No complex math needed.

---

## Lessons Learned

### 1. Be Clear About Coordinate Systems

- **Screen coordinates (clientX/Y)**: Relative to browser viewport
- **Document coordinates**: Include scroll offset
- Mix them = guaranteed bugs

### 2. How position: absolute Actually Works

```html
<div style="position: relative; overflow: auto;">  <!-- Scroll container -->
  <div style="position: absolute; left: 100px; top: 500px;">
    <!-- This div is at 100, 500 relative to scrolled content -->
    <!-- Browser handles scroll rendering automatically -->
  </div>
</div>
```

### 3. Debug Step by Step

My 5-attempt journey:
1. Symptom: Marquee box breaks
2. Hypothesis 1: Scroll offset issue → Failed
3. Hypothesis 2: Missing auto-scroll → Partial fix
4. Hypothesis 3: Mixed coordinates → Core issue found!
5. Hypothesis 4: Mouse position issue → Not related
6. Hypothesis 5: Misunderstood CSS → Bingo!

---

## Working Result

Now it works perfectly:
- ✅ Drag while scrolling → Marquee box follows smoothly
- ✅ Drag outside container → Auto-scrolls + extends selection
- ✅ Select hundreds of items in one drag

---

## The Real Bug Was My Understanding

Complex-looking bugs usually come from misunderstanding fundamentals.

If I'd properly understood how position: absolute works, could've saved 5 rewrites. Should've read MDN docs more carefully... 🤦‍♂️

**Key takeaway: Don't mix coordinate systems. Pick one, stick with it.**

Sometimes the browser is smarter than we think. Let it do its job.