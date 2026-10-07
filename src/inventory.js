/* Inventory: a fixed array of slots, each null or { id, qty }. */
(function (GHV) {
  'use strict';
  const C = GHV.CONFIG;

  function maxStack(id) {
    const item = GHV.ITEMS[id];
    return item && item.kind === 'tool' ? 1 : C.STACK_SIZE;
  }

  function create(size) {
    return new Array(size).fill(null);
  }

  function count(inv, id) {
    let n = 0;
    for (const s of inv) if (s && s.id === id) n += s.qty;
    return n;
  }

  // How many of `id` could be added right now.
  function room(inv, id) {
    const max = maxStack(id);
    let n = 0;
    for (const s of inv) {
      if (!s) n += max;
      else if (s.id === id) n += max - s.qty;
    }
    return n;
  }

  // Adds up to qty; returns how many did NOT fit.
  function add(inv, id, qty) {
    if (!GHV.ITEMS[id]) throw new Error('Unknown item: ' + id);
    const max = maxStack(id);
    let left = qty;
    for (const s of inv) {
      if (left <= 0) break;
      if (s && s.id === id && s.qty < max) {
        const n = Math.min(max - s.qty, left);
        s.qty += n;
        left -= n;
      }
    }
    for (let i = 0; i < inv.length && left > 0; i++) {
      if (!inv[i]) {
        const n = Math.min(max, left);
        inv[i] = { id: id, qty: n };
        left -= n;
      }
    }
    return left;
  }

  // Removes qty of id across slots (last slots first, so the hotbar keeps its stack).
  // Returns false and changes nothing if there aren't enough.
  function remove(inv, id, qty) {
    if (count(inv, id) < qty) return false;
    let left = qty;
    for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
      const s = inv[i];
      if (s && s.id === id) {
        const n = Math.min(s.qty, left);
        s.qty -= n;
        left -= n;
        if (s.qty <= 0) inv[i] = null;
      }
    }
    return true;
  }

  function removeAt(inv, slot, qty) {
    const s = inv[slot];
    if (!s) return 0;
    const n = Math.min(s.qty, qty);
    s.qty -= n;
    if (s.qty <= 0) inv[slot] = null;
    return n;
  }

  // Move or swap slot a into slot b, merging stacks of the same item.
  function moveSlot(inv, a, b) {
    if (a === b) return;
    const sa = inv[a], sb = inv[b];
    if (sa && sb && sa.id === sb.id) {
      const max = maxStack(sa.id);
      const n = Math.min(max - sb.qty, sa.qty);
      sb.qty += n;
      sa.qty -= n;
      if (sa.qty <= 0) inv[a] = null;
      return;
    }
    inv[a] = sb;
    inv[b] = sa;
  }

  GHV.Inventory = {
    maxStack: maxStack,
    create: create,
    count: count,
    room: room,
    add: add,
    remove: remove,
    removeAt: removeAt,
    moveSlot: moveSlot,
  };
})(window.GHV = window.GHV || {});
