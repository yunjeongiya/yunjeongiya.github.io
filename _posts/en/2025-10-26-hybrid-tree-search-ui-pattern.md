---
layout: post
title: "Beyond Filtered Search: A Hybrid Tree Search UI Pattern That Shows Both Results and Context"
date: 2025-10-26 14:30:00 +0900
categories: [Frontend, React]
tags: [React, UI/UX, TreeStructure, Search, useRef, scrollIntoView, UserExperience]
lang: en
---

## TL;DR

Building search for a tree of hundreds of templates (loaded from a 232KB CSV), I faced the question: "Show filtered results only? Or show the full tree?" Ended up with a **hybrid pattern** that shows both. Here's how I used React useRef Map to find DOM nodes in a recursive tree and scrollIntoView to smoothly navigate to them.

---

## Background: Unusable Without Search

In an education management system, teachers assign tasks to students. The right panel shows hundreds of templates in a tree structure.

```
High School
├─ Common Math 1
│  ├─ LV1
│  │  ├─ Lesson 001. Polynomial Operations
│  │  ├─ Lesson 002. Remainder Theorem
│  │  ├─ ... (50+ items)
│  └─ LV2
│     ├─ Lesson 001. Complex Numbers
│     └─ ... (50+ items)
└─ Common Math 2
   └─ ... (continues)
```

The problem was clear:
- Tree too large to find items
- Had to expand folders one by one
- Finding "Lesson 002 Remainder Theorem" required endless scrolling

Time to add search.

---

## The Dilemma: Three Patterns, Which One?

### Pattern 1: Filtered Tree

First thought: "Show only matching nodes + parent paths."

```typescript
// Filter tree to show only matching nodes
const filteredTree = filterTreeByQuery(tree, searchQuery);
```

**Pros:**
- Focus on search results
- Simple implementation

**Cons:**
- **Lose context of surrounding items**
- Can't see what comes after "LV1's Lesson 002"
- Hard to compare similar items

User feedback: "I found 002, but I want to see 003 too. Do I have to search again?"

---

### Pattern 2: Highlight Pattern

<div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
  <div style="flex: 1; min-width: 300px;" markdown="1">

Second attempt: "Keep the full tree, but highlight matching results."

```typescript
// Keep full tree + highlight matching nodes
const highlightMatchingNodes = (node: TreeNode, query: string) => {
  return node.title.includes(query);
};
```

**Pros:**
- Full tree context preserved
- Can see surrounding items

**Cons:**
- **Hard to find when there are many results**
- Have to scroll through and check each highlighted item
- Can't tell at a glance how many results there are

User feedback: "Items are highlighted in yellow, but I don't know how many there are and it's hard to find them"

  </div>
  <div style="flex: 0 0 300px;">
    <img src="/assets/images/posts/2025-10-26-hybrid-tree-search/before.png" alt="Highlight pattern" style="width: 100%; max-width: 300px;">
    <p style="text-align: center; margin-top: 10px;"><em>Pattern 2: Highlighting search results in full tree</em></p>
  </div>
</div>

---

### Pattern 3: Hybrid Pattern (Final Choice)

<div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
  <div style="flex: 1; min-width: 300px;" markdown="1">

So I came up with a "search result list + full tree" approach - showing both simultaneously. The top section displays a list of matching templates, while the bottom section maintains the full tree structure with matched items highlighted.

**Pros:**
- Quick scan of search results (top list)
- Full tree context preserved (bottom tree)
- "Show in tree" button jumps to exact location
- Clear display of result count

**User feedback:** "This is much better! I can quickly browse the list and immediately check the location"

  </div>
  <div style="flex: 0 0 300px;">
    <img src="/assets/images/posts/2025-10-26-hybrid-tree-search/after.png" alt="Hybrid pattern" style="width: 100%; max-width: 300px;">
    <p style="text-align: center; margin-top: 10px;"><em>Pattern 3 (Hybrid): Search results list (top) + full tree (bottom)</em></p>
  </div>
</div>

---

## Implementation: Managing Dynamic DOM References with React useRef

The key to the hybrid pattern is the "Show in tree" button. When you click an item in search results, it should scroll to that location in the tree below and highlight it.

### Problem: Finding DOM Elements in a Recursive Tree

The tree is implemented as a recursive component:

```typescript
const TaskNode: React.FC<TaskNodeProps> = ({ node, level }) => {
  return (
    <div>
      <div>{node.title}</div>
      {node.children?.map(child => (
        <TaskNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
};
```

How do we reference a specific node's DOM element? `document.querySelector`? Too slow and fragile.

### Solution: useRef + Map

**Idea:** Have each node register its DOM element in a Map when it renders.

```typescript
// 1. Map for node ID → DOM element
const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());

// 2. Add ref callback to each node in the recursive component
<div
  ref={(el) => {
    if (el) {
      nodeRefs.current.set(node.id, el);
    }
  }}
  className={`tree-node ${isHighlighted ? 'highlight' : ''}`}
>
  {node.title}
</div>
```

Now `nodeRefs.current.get(nodeId)` gives us any node's DOM element instantly.

### Implementing "Show in Tree"

```typescript
const showNodeInTree = useCallback((nodeId: number) => {
  // 1. Find and expand parent folders
  const nodesToExpand = new Set<number>();
  findAndExpandParents(templateTree, nodeId, nodesToExpand);
  setExpandedNodes(prev => new Set([...prev, ...nodesToExpand]));

  // 2. Wait for DOM update, then scroll
  setTimeout(() => {
    const nodeElement = nodeRefs.current.get(nodeId);
    if (nodeElement) {
      nodeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }

    // 3. Apply highlight (2 seconds)
    setHighlightedNodeId(nodeId);
    setTimeout(() => setHighlightedNodeId(null), 2000);
  }, 100);
}, [templateTree]);
```

**Key Points:**

1. **Expand folders first**: Make target node visible
2. **Wait 100ms**: React state update → DOM reflection takes time
3. **scrollIntoView**: Smooth scrolling
4. **2-second highlight**: User clearly sees where they landed

### Why setTimeout is Necessary

```typescript
// ❌ This won't scroll
setExpandedNodes(newNodes);
nodeElement.scrollIntoView();  // Folder not expanded yet, element hidden

// ✅ Need to wait for DOM update
setExpandedNodes(newNodes);
setTimeout(() => {
  nodeElement.scrollIntoView();  // Now element is visible
}, 100);
```

React updates state asynchronously. Even after calling `setExpandedNodes`, the DOM doesn't change immediately. We need to wait for the next render cycle.

---

## Bug: Search Query Disappearing

In the initial implementation, clicking "Show in tree" cleared the search query.

```typescript
// ❌ Initial implementation
const showNodeInTree = useCallback((nodeId: number) => {
  setExpandedNodes(/* ... */);
  setSearchQuery('');  // Clear search - bad idea!
  // ...
});
```

**Intent:** Exit search mode and show full tree

**Problem:** What if users want to see search results again? They'd have to retype the query.

**Solution:** Remove `setSearchQuery('')`. Keep search results while navigating to tree location.

```typescript
// ✅ Improved implementation
const showNodeInTree = useCallback((nodeId: number) => {
  setExpandedNodes(/* ... */);
  // Keep search query!
  // ...
});
```

Now users can:
1. View search results list
2. Click "Show in tree" to see tree location
3. Return to search results and select another item

This flow works naturally.

---

## Results

### Measurable Improvements

- **Search results list:** Average 3-5 items shown (out of 200 total)
- **Reduced scrolling:** 10+ scrolls → 1 search + 1 click
- **Tree context preserved:** Can explore full structure

### User Feedback

- "Found 002, and can immediately check 003 next to it"
- "Search results don't disappear, so comparing items is easy"
- "Tree auto-expands and scrolls, never lose track of position"

---

## Key Takeaways

### 1. Search UI Isn't Just About Filtering

Filtered search results are clean, but lose context in large hierarchies. The hybrid pattern provides both "quick access + full context."

### 2. useRef Map Pattern Works Well for Recursive Structures

When you need DOM references in recursive components:
- Each node self-registers via ref callback
- Map provides O(1) lookup
- Safer and faster than querySelector

### 3. DOM Timing Issues? Use setTimeout

React state updates take time to reflect in DOM. For DOM operations like `scrollIntoView`, defer with `setTimeout` by one tick.

### 4. UX Details Matter

- Keeping vs clearing search query - small difference, huge impact on usability
- 2-second highlight - visual feedback helps users instantly recognize position
- Smooth scrolling - prevents jarring screen jumps

---

## Considerations

### 1. Memory Management

The `nodeRefs` Map can grow. Clean up on component unmount:

```typescript
useEffect(() => {
  return () => {
    nodeRefs.current.clear();
  };
}, []);
```

### 2. Large Tree Performance

For thousands of nodes:
- Consider virtual scrolling (react-window, react-virtualized)
- Paginate search results
- Debounce search input

### 3. Accessibility

- Keyboard navigation (Arrow keys, Enter)
- ARIA attributes (`role="tree"`, `aria-expanded`)
- Alternative text for screen readers

---

## References

- [MDN - Element.scrollIntoView()](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)
- [React Hooks: useRef](https://react.dev/reference/react/useRef)
- [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

---

**Next Steps:**
- Apply fuzzy search algorithm (e.g., "remainder" → "remainder theorem" matching)
- Recent search history
- Favorite templates feature
