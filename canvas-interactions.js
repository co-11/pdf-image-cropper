// canvas-interactions.js
import {
  state, dom, qs, showToast,
  overlayToCanvasPoint, applyZoomTransform
} from './core.js';

import {
  getOverlayCoords, calcRect, drawRect,
  redrawState,
  confirmHeaderRegion, confirmHeaderRowRegion, confirmFixedHeaderRegion,
  confirmTargetRegion, confirmManualTarget, confirmSingleTarget,
  drawUserLines, saveUserLinesForCurrentPage,
  snapAxisAligned, rectToLines,
  hitTestUserLine, hitTestUserLineEndpoint,
  hitTestUserLinesInOverlayRect,
  getLineEndpointCursorType,
  executeCrop,
  renderCropPreviewBand,
  pushUndoSnapshot,
  performUndo
} from './pdf-workflow.js';

import {
  isCanvasEditSelectionMode, ensureEditItemsForCurrentPage,
  saveEditItemsForCurrentPage, cloneEditItem,
  getSelectedEditItem, hitTestEditItem, hitTestEditResizeHandle,
  buildEditClipboardFromOverlayRect, getViewportCenterCanvasPoint,
  pasteEditClipboardAt, showInlineTextInput, removeSelectedEditItem,
  setEditTool, renderEditOverlay,
  calcAspectLockedSize, getEditCursorForPoint,
  hitTestEditItemsInOverlayRect, buildMultiItemClipboard
} from './edit-mode.js';

// ===== User line interactions (pointer) =====
function setupRecoveredUserLineInteractions() {
  if (!dom.selectionOverlay) return;
  if (dom.selectionOverlay.dataset.recoveredUserLineInteractionsBound === 'true') return;
  dom.selectionOverlay.dataset.recoveredUserLineInteractionsBound = 'true';
  const canHandle = () => state.selectionMode === 'grid' && state.drawTool === 'select';
  const clearSelection = () => {
    state.selectedUserLineIndex = -1;
    state.selectedUserLineIndices = [];
  };
  const finishDrag = (e) => {
    const drag = state._toolDrag;
    if (!drag) return;
    if (e && drag.pointerId != null && drag.pointerId !== e.pointerId) return;
    if (drag.type === 'moveUserLine' && drag.copyOnDrag && drag.originals) {
      const newLines = [];
      (drag.indices || []).forEach(idx => {
        const moved = state.userLines[idx] ? {...state.userLines[idx]} : null;
        const orig = drag.originals[idx];
        if (orig) state.userLines[idx] = {...orig};
        if (moved) newLines.push(moved);
      });
      state.userLines.push(...newLines);
      const startIdx = state.userLines.length - newLines.length;
      state.selectedUserLineIndices = newLines.map((_, i) => startIdx + i);
      state.selectedUserLineIndex = state.selectedUserLineIndices[0] ?? -1;
      showToast('罫線をコピーしました');
    }
    state._toolDrag = null;
    try {
      if (e && dom.selectionOverlay.hasPointerCapture?.(e.pointerId)) {
        dom.selectionOverlay.releasePointerCapture(e.pointerId);
      }
    } catch (err) {
      console.warn('releasePointerCapture failed', err);
    }
    saveUserLinesForCurrentPage();
    drawUserLines();
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  dom.selectionOverlay.addEventListener('pointerdown', (e) => {
    if (!canHandle() || e.button !== 0) return;
    const canvasPt = overlayToCanvasPoint(getOverlayCoords(e));
    const endpointHit = hitTestUserLineEndpoint(canvasPt);
    if (endpointHit) {
      state.selectedUserLineIndex = endpointHit.index;
      state.selectedUserLineIndices = [endpointHit.index];
      state._toolDrag = {
        type: 'resizeUserLine', pointerId: e.pointerId,
        index: endpointHit.index, endpoint: endpointHit.endpoint
      };
      dom.selectionOverlay.setPointerCapture?.(e.pointerId);
      drawUserLines();
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    const lineIndex = hitTestUserLine(canvasPt);
    if (lineIndex >= 0) {
      if (!state.selectedUserLineIndices || state.selectedUserLineIndices.indexOf(lineIndex) < 0) {
        state.selectedUserLineIndex = lineIndex;
        state.selectedUserLineIndices = [lineIndex];
      } else {
        state.selectedUserLineIndex = lineIndex;
      }
      const originals = {};
      state.selectedUserLineIndices.forEach(idx => {
        if (state.userLines[idx]) originals[idx] = {...state.userLines[idx]};
      });
      state._toolDrag = {
        type: 'moveUserLine', pointerId: e.pointerId,
        indices: state.selectedUserLineIndices.slice(),
        originals, startCanvasPt: canvasPt,
        copyOnDrag: (e.ctrlKey || e.metaKey)
      };
      dom.selectionOverlay.setPointerCapture?.(e.pointerId);
      drawUserLines();
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    clearSelection();
    drawUserLines();
  }, true);
  dom.selectionOverlay.addEventListener('pointermove', (e) => {
    const drag = state._toolDrag;
    if (!drag || !canHandle()) return;
    if (drag.pointerId != null && drag.pointerId !== e.pointerId) return;
    const canvasPt = overlayToCanvasPoint(getOverlayCoords(e));
    if (drag.type === 'moveUserLine') {
      const dx = canvasPt.x - drag.startCanvasPt.x;
      const dy = canvasPt.y - drag.startCanvasPt.y;
      (drag.indices || []).forEach(idx => {
        const ln = state.userLines[idx];
        const orig = drag.originals ? drag.originals[idx] : null;
        if (ln && orig) {
          ln.x1 = orig.x1 + dx; ln.y1 = orig.y1 + dy;
          ln.x2 = orig.x2 + dx; ln.y2 = orig.y2 + dy;
        }
      });
      drawUserLines();
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    const line = state.userLines[drag.index];
    if (!line) return;
    if (drag.type === 'resizeUserLine') {
      if (drag.endpoint === 'a') { line.x1 = canvasPt.x; line.y1 = canvasPt.y; }
      else { line.x2 = canvasPt.x; line.y2 = canvasPt.y; }
      const snapped = snapAxisAligned({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
      line.x1 = snapped.x1; line.y1 = snapped.y1;
      line.x2 = snapped.x2; line.y2 = snapped.y2;
    }
    drawUserLines();
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  dom.selectionOverlay.addEventListener('pointerup', finishDrag, true);
  dom.selectionOverlay.addEventListener('pointercancel', finishDrag, true);
}

// ===== Fallback line drawing =====
function setupFallbackLineDrawing() {
  if (!dom.selectionOverlay || !dom.canvasContainer) return;
  if (dom.selectionOverlay.dataset.lineFallbackBound === 'true') return;
  dom.selectionOverlay.dataset.lineFallbackBound = 'true';
  let dragState = null;
  const minSize = 3;
  const isLineToolActive = () =>
    state.selectionMode === 'grid' && (state.drawTool === 'line' || state.drawTool === 'rect');
  const getCanvasPointFromEvent = (e) => {
    const rect = dom.selectionOverlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    return overlayToCanvasPoint({ x, y });
  };
  const stopEvent = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const handlePointerDown = (e) => {
    if (e.button !== 0 || !isLineToolActive()) return;
    const canvasPt = getCanvasPointFromEvent(e);
    if (!canvasPt) return;
    dragState = { start: canvasPt, tool: state.drawTool };
    state._lineStartCanvas = canvasPt;
    state._toolDrag = { kind: state.drawTool, start: canvasPt };
    stopEvent(e);
  };
  const handlePointerMove = (e) => {
    if (!dragState || !isLineToolActive()) return;
    const canvasPt = getCanvasPointFromEvent(e);
    if (!canvasPt) return;
    const preview = dragState.tool === 'rect'
      ? rectToLines(dragState.start, canvasPt)
      : snapAxisAligned(dragState.start, canvasPt);
    drawUserLines({ preview });
    stopEvent(e);
  };
  const handlePointerUp = (e) => {
    if (!dragState) return;
    const canvasPt = getCanvasPointFromEvent(e);
    if (canvasPt) {
      if (dragState.tool === 'rect') {
        const width = Math.abs(canvasPt.x - dragState.start.x);
        const height = Math.abs(canvasPt.y - dragState.start.y);
        if (width >= minSize && height >= minSize) {
          state.userLines.push(...rectToLines(dragState.start, canvasPt));
        }
      } else {
        const line = snapAxisAligned(dragState.start, canvasPt);
        const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
        if (length >= minSize) state.userLines.push(line);
      }
      saveUserLinesForCurrentPage();
    }
    dragState = null;
    state._toolDrag = null;
    state._lineStartCanvas = null;
    drawUserLines();
    stopEvent(e);
  };
  [dom.selectionOverlay, dom.canvasContainer, dom.pdfCanvas].forEach((el) => {
    if (!el) return;
    el.addEventListener('mousedown', handlePointerDown, true);
    el.addEventListener('mousemove', handlePointerMove, true);
  });
  window.addEventListener('mousemove', handlePointerMove, true);
  window.addEventListener('mouseup', handlePointerUp, true);
}

// ===== Overlay selection (★ copy/select 分割対応済み) =====
function setupOverlaySelection() {
  // --- mousedown ---
  dom.selectionOverlay?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isCanvasEditSelectionMode()) {
      ensureEditItemsForCurrentPage();
      const overlayPt = getOverlayCoords(e);
      const canvasPt = overlayToCanvasPoint(overlayPt);
      if (state.drawTool === 'text') {
        showInlineTextInput(overlayPt, canvasPt);
        e.preventDefault();
        return;
      }
      if (state.drawTool === 'crop') {
        state._cropPreview = null;
        dom.selectionOverlay.querySelector('.crop-preview-band')?.remove();
        if (dom.btnCropExec) dom.btnCropExec.style.display = 'none';
        state._cropDrag = { start: overlayPt };
        state.isDragging = true;
        state.dragStart = overlayPt;
        state.dragCurrent = { ...overlayPt };
        e.preventDefault();
        return;
      }
      const resizeHit = hitTestEditResizeHandle(canvasPt);
      if (resizeHit) {
        const item = getSelectedEditItem();
        if (item) {
          pushUndoSnapshot();
          state._editDrag = {
            kind: 'resize', id: item.id,
            startX: canvasPt.x, startY: canvasPt.y,
            startW: item.w, startH: item.h,
            startFontSize: item.fontSize || 24
          };
          e.preventDefault();
          return;
        }
      }
      const hit = hitTestEditItem(canvasPt);
      if (hit) {
        if (e.shiftKey) {
          const idx = (state.selectedEditItemIds || []).indexOf(hit.id);
          if (idx >= 0) {
            state.selectedEditItemIds.splice(idx, 1);
            if (state.selectedEditItemId === hit.id) state.selectedEditItemId = state.selectedEditItemIds[0] || null;
          } else {
            state.selectedEditItemIds = (state.selectedEditItemIds || []).concat([hit.id]);
            state.selectedEditItemId = hit.id;
          }
          state.editSelectionRect = null;
          renderEditOverlay();
          e.preventDefault();
          return;
        }
        pushUndoSnapshot();
        state.selectedEditItemId = hit.id;
        state.selectedEditItemIds = [hit.id];
        state.editSelectionRect = null;
        state._editDrag = {
          kind: 'move', id: hit.id,
          offsetX: canvasPt.x - hit.x,
          offsetY: canvasPt.y - hit.y
        };
        renderEditOverlay();
        e.preventDefault();
        return;
      }
      // ★ select / copy 両方で範囲ドラッグ開始
      if (state.drawTool === 'select' || state.drawTool === 'copy') {
        state.selectedEditItemId = null;
        state.selectedEditItemIds = [];
        state._editDrag = null;
        state.isDragging = true;
        state.dragStart = overlayPt;
        state.dragCurrent = { ...state.dragStart };
        state.editSelectionRect = calcRect(state.dragStart, state.dragCurrent);
        renderEditOverlay();
        e.preventDefault();
        return;
      }
    }
    if (state.selectionMode === 'grid') {
      const canvasPt = overlayToCanvasPoint(getOverlayCoords(e));
      if (state.drawTool === 'line' || state.drawTool === 'rect') {
        state._toolDrag = {
          kind: state.drawTool, startCanvas: canvasPt, lastCanvas: canvasPt
        };
        e.preventDefault();
        return;
      }
      if (state.drawTool === 'select') {
        const ep = hitTestUserLineEndpoint(canvasPt);
        if (ep) {
          state.selectedUserLineIndex = ep.index;
          state._toolDrag = {
            kind: 'resizeLine', startCanvas: canvasPt, lastCanvas: canvasPt,
            index: ep.index, endpoint: ep.endpoint
          };
          drawUserLines();
          e.preventDefault();
          return;
        }
        const hitLine = hitTestUserLine(canvasPt);
        state.selectedUserLineIndex = hitLine;
        if (hitLine >= 0) {
          if (!state.selectedUserLineIndices || state.selectedUserLineIndices.indexOf(hitLine) < 0) {
            state.selectedUserLineIndices = [hitLine];
          }
          state._toolDrag = {
            kind: 'moveLine', startCanvas: canvasPt, lastCanvas: canvasPt,
            indices: state.selectedUserLineIndices.slice(),
            copyOnDrag: (e.ctrlKey || e.metaKey)
          };
          drawUserLines();
          e.preventDefault();
          return;
        }
      }
    }
    state.isDragging = true;
    state.dragStart = getOverlayCoords(e);
    state.dragCurrent = { ...state.dragStart };
    dom.selectionOverlay.querySelectorAll('.selection-rect:not(.confirmed)').forEach((r) => r.remove());
  });

  // --- mousemove ---
  dom.selectionOverlay?.addEventListener('mousemove', (e) => {
    if (isCanvasEditSelectionMode()) {
      const overlayPt = getOverlayCoords(e);
      const canvasPt = overlayToCanvasPoint(overlayPt);
      if (state._cropDrag && state.isDragging) {
        state.dragCurrent = overlayPt;
        const sx = state._cropDrag.start.x, sy = state._cropDrag.start.y;
        const adx = Math.abs(overlayPt.x - sx), ady = Math.abs(overlayPt.y - sy);
        let band = dom.selectionOverlay.querySelector('.crop-preview-band');
        if (!band) {
          band = document.createElement('div');
          band.className = 'crop-preview-band';
          Object.assign(band.style, { position: 'absolute', pointerEvents: 'none', zIndex: '30', background: 'rgba(239,68,68,0.25)' });
          dom.selectionOverlay.appendChild(band);
        }
        const ow = dom.selectionOverlay.clientWidth, oh = dom.selectionOverlay.clientHeight;
        if (state.cropDirection === 'horizontal') {
          Object.assign(band.style, { left: '0', top: Math.min(sy, overlayPt.y) + 'px', width: ow + 'px', height: ady + 'px', borderTop: '2px dashed #ef4444', borderBottom: '2px dashed #ef4444', borderLeft: 'none', borderRight: 'none' });
        } else {
          Object.assign(band.style, { left: Math.min(sx, overlayPt.x) + 'px', top: '0', width: adx + 'px', height: oh + 'px', borderLeft: '2px dashed #ef4444', borderRight: '2px dashed #ef4444', borderTop: 'none', borderBottom: 'none' });
        }
        return;
      }
      if (state._editDrag) {
        const item = getSelectedEditItem();
        if (item) {
          if (state._editDrag.kind === 'resize') {
            const newW = Math.max(20, canvasPt.x - item.x);
            if (item.type === 'image') {
              const locked = calcAspectLockedSize(item, newW);
              item.w = locked.w;
              item.h = locked.h;
            } else {
              item.w = newW;
              item.h = Math.max(20, canvasPt.y - item.y);
            }
            if (item.type === 'text') {
              const ratio = Math.min(item.w / Math.max(1, state._editDrag.startW), item.h / Math.max(1, state._editDrag.startH));
              item.fontSize = Math.max(12, Math.round(state._editDrag.startFontSize * ratio));
            }
          } else {
            item.x = Math.max(0, Math.round(canvasPt.x - state._editDrag.offsetX));
            item.y = Math.max(0, Math.round(canvasPt.y - state._editDrag.offsetY));
          }
          renderEditOverlay();
        }
        return;
      }
      if (state.isDragging && state.editSelectionRect) {
        state.dragCurrent = overlayPt;
        state.editSelectionRect = calcRect(state.dragStart, state.dragCurrent);
        renderEditOverlay();
        return;
      }
    }
    // ★ select / copy 両方でカーソル切替
    if (isCanvasEditSelectionMode() && (state.drawTool === 'select' || state.drawTool === 'copy') && !state._editDrag) {
      const cp = overlayToCanvasPoint(getOverlayCoords(e));
      if (state.drawTool === 'select') {
        const editCursor = getEditCursorForPoint(cp);
        if (editCursor) {
          dom.selectionOverlay.style.cursor = editCursor;
          return;
        }
      }
      const lineCursor = getLineEndpointCursorType(cp);
      if (lineCursor) {
        dom.selectionOverlay.style.cursor = lineCursor;
        return;
      }
      if (state.drawTool === 'select' && hitTestUserLine(cp) >= 0) {
        dom.selectionOverlay.style.cursor = 'move';
        return;
      }
      dom.selectionOverlay.style.cursor = 'crosshair';
    }
    if (state.selectionMode === 'grid' && state._toolDrag) {
      const canvasPt = overlayToCanvasPoint(getOverlayCoords(e));
      state._toolDrag.lastCanvas = canvasPt;
      if (state._toolDrag.kind === 'line') {
        drawUserLines({ preview: snapAxisAligned(state._toolDrag.startCanvas, canvasPt) });
        return;
      }
      if (state._toolDrag.kind === 'rect') {
        drawUserLines({ preview: rectToLines(state._toolDrag.startCanvas, canvasPt) });
        return;
      }
      return;
    }
    if (!state.isDragging) return;
    state.dragCurrent = getOverlayCoords(e);
    dom.selectionOverlay.querySelectorAll('.selection-rect:not(.confirmed)').forEach((r) => r.remove());
    const r = calcRect(state.dragStart, state.dragCurrent);
    drawRect(r,
      state.mode === 'fixedHeader' ? 'fixed-header-sel'
      : state.mode === 'headerRow' ? 'header-row-sel'
      : state.mode === 'header' ? 'header-sel'
      : 'target-sel'
    );
  });

  // --- mouseup ---
  dom.selectionOverlay?.addEventListener('mouseup', (e) => {
    if (isCanvasEditSelectionMode()) {
      if (state._cropDrag) {
        state.isDragging = false;
        const end = getOverlayCoords(e);
        const cStart = state._cropDrag.start;
        state._cropDrag = null;
        const adx = Math.abs(end.x - cStart.x), ady = Math.abs(end.y - cStart.y);
        if (adx >= 5 || ady >= 5) {
          const sc = overlayToCanvasPoint(cStart), ec = overlayToCanvasPoint(end);
          let op;
          if (state.cropDirection === 'horizontal') {
            op = { direction: 'horizontal', y1: Math.round(Math.min(sc.y, ec.y)), y2: Math.round(Math.max(sc.y, ec.y)) };
          } else {
            op = { direction: 'vertical', x1: Math.round(Math.min(sc.x, ec.x)), x2: Math.round(Math.max(sc.x, ec.x)) };
          }
          state._cropPreview = op;
          if (dom.btnCropExec) dom.btnCropExec.style.display = 'inline-flex';
          showToast('実行ボタンで切り取りを確定');
        } else {
          dom.selectionOverlay.querySelector('.crop-preview-band')?.remove();
        }
        return;
      }
      if (state._editDrag) {
        state._editDrag = null;
        saveEditItemsForCurrentPage();
        renderEditOverlay();
        return;
      }
      if (state.isDragging && state.editSelectionRect) {
        state.isDragging = false;
        state.dragCurrent = getOverlayCoords(e);
        state.editSelectionRect = calcRect(state.dragStart, state.dragCurrent);
        // ★ コピーツール: クリップボードに範囲コピー → 矩形を残す
        if (state.drawTool === 'copy') {
          if (state.editSelectionRect.w >= 5 && state.editSelectionRect.h >= 5) {
            buildEditClipboardFromOverlayRect(state.editSelectionRect).then((clip) => {
              if (clip) { state.editClipboard = clip; showToast('範囲をコピーしました'); }
            });
          }
          renderEditOverlay();
          return;
        }
        // ★ 選択ツール: 罫線＋アイテム範囲選択 → 矩形をクリア
        if (state.editSelectionRect.w >= 5 && state.editSelectionRect.h >= 5) {
          const hits = hitTestUserLinesInOverlayRect(state.editSelectionRect);
          if (hits.length > 0) {
            state.selectedUserLineIndices = hits;
            state.selectedUserLineIndex = hits[0];
            drawUserLines();
          }
          const itemHits = hitTestEditItemsInOverlayRect(state.editSelectionRect);
          if (itemHits.length > 0) {
            state.selectedEditItemIds = itemHits;
            state.selectedEditItemId = itemHits[0];
          }
        }
        state.editSelectionRect = null;
        renderEditOverlay();
        return;
      }
    }
    if (state.selectionMode === 'grid' && state._toolDrag) {
      const start = state._toolDrag.startCanvas;
      const end = state._toolDrag.lastCanvas || start;
      if (state._toolDrag.kind === 'line') {
        const L = snapAxisAligned(start, end);
        if (Math.hypot(L.x2 - L.x1, L.y2 - L.y1) >= 5) {
          pushUndoSnapshot();
          state.userLines.push(L);
          saveUserLinesForCurrentPage();
          showToast('直線を追加しました');
        }
        state._toolDrag = null;
        drawUserLines();
        return;
      }
      if (state._toolDrag.kind === 'rect') {
        const rectLines = rectToLines(start, end);
        if (Math.abs(end.x - start.x) >= 5 && Math.abs(end.y - start.y) >= 5) {
          pushUndoSnapshot();
          rectLines.forEach((L) => state.userLines.push(L));
          saveUserLinesForCurrentPage();
          showToast('矩形を追加しました');
        }
        state._toolDrag = null;
        drawUserLines();
        return;
      }
    }
    if (!state.isDragging) return;
    state.isDragging = false;
    state.dragCurrent = getOverlayCoords(e);
    const r = calcRect(state.dragStart, state.dragCurrent);
    if (r.w < 5 || r.h < 5) return;
    if (state.mode === 'header') confirmHeaderRegion(r);
    else if (state.mode === 'fixedHeader') confirmFixedHeaderRegion(r);
    else if (state.mode === 'headerRow') confirmHeaderRowRegion(r);
    else if (state.mode === 'target') confirmTargetRegion(r);
    else if (state.mode === 'manual') confirmManualTarget(r);
    else if (state.mode === 'single') confirmSingleTarget(r);
  });
}

// ===== Clear lines =====
function setupClearLines() {
  dom.btnClearLines?.addEventListener('click', () => {
    if (state.selectionMode !== 'grid') return;
    const pageNum = state.selectedPages[state.currentWorkPage];
    state.userLines = [];
    state.userLinesByPage[pageNum] = [];
    state.selectedUserLineIndex = -1;
    state.selectedUserLineIndices = [];
    dom.btnClearLines.disabled = true;
    drawUserLines();
    showToast('罫線をクリアしました');
  });
}

// ===== Keyboard =====
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isTyping = !!(activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName));
    const isEditTextInput = activeEl === qs('#editTextInput');
    if (isTyping && !isEditTextInput) return;
    if (!isTyping && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      performUndo().then(() => renderEditOverlay());
      e.preventDefault();
      return;
    }
    if (isCanvasEditSelectionMode()) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (state.selectedEditItemIds && state.selectedEditItemIds.length > 1) {
          buildMultiItemClipboard().then((clip) => {
            if (clip) { state.editClipboard = clip; showToast('選択アイテムをコピーしました'); }
          });
          e.preventDefault();
          return;
        }
        const item = getSelectedEditItem();
        if (item) {
          state.editClipboard = cloneEditItem(item);
          showToast('編集アイテムをコピーしました');
          e.preventDefault();
          return;
        } else if (state.editSelectionRect && state.editSelectionRect.w >= 5 && state.editSelectionRect.h >= 5) {
          buildEditClipboardFromOverlayRect(state.editSelectionRect).then((clip) => {
            if (clip) { state.editClipboard = clip; showToast('範囲をコピーしました'); }
          });
          e.preventDefault();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (state.editClipboard) {
          pasteEditClipboardAt(getViewportCenterCanvasPoint());
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Delete') {
        if (state.selectedEditItemId || (state.selectedEditItemIds && state.selectedEditItemIds.length)) {
          removeSelectedEditItem();
          e.preventDefault();
          return;
        }
      }
    }
    if (isTyping) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (state.drawTool === 'select' && state.selectedUserLineIndex >= 0) {
        const L = state.userLines[state.selectedUserLineIndex];
        if (L) {
          state._copiedUserLine = { ...L };
          state.editClipboard = null;
          showToast('罫線をコピーしました');
          e.preventDefault();
        }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (state.drawTool === 'select' && state._copiedUserLine) {
        const copy = {
          x1: state._copiedUserLine.x1 + 20, y1: state._copiedUserLine.y1 + 20,
          x2: state._copiedUserLine.x2 + 20, y2: state._copiedUserLine.y2 + 20
        };
        state.userLines.push(copy);
        state.selectedUserLineIndex = state.userLines.length - 1;
        saveUserLinesForCurrentPage();
        drawUserLines();
        showToast('罫線を貼り付けました');
        e.preventDefault();
      }
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (state.drawTool !== 'select') return;
    const idxs = (state.selectedUserLineIndices && state.selectedUserLineIndices.length)
      ? state.selectedUserLineIndices.slice()
      : (state.selectedUserLineIndex >= 0 ? [state.selectedUserLineIndex] : []);
    if (!idxs.length) return;
    pushUndoSnapshot();
    idxs.sort((a, b) => b - a);
    for (let i = 0; i < idxs.length; i++) {
      if (idxs[i] >= 0 && idxs[i] < state.userLines.length) {
        state.userLines.splice(idxs[i], 1);
      }
    }
    state.selectedUserLineIndex = -1;
    state.selectedUserLineIndices = [];
    saveUserLinesForCurrentPage();
    drawUserLines();
    showToast('選択した罫線を削除しました');
  });
}

// ===== Zoom =====
function getMinScale() {
  return (!state.pdfDoc || !dom.pdfCanvas.height)
    ? 0.5
    : Math.max((dom.canvasContainer.clientHeight - 4) / (dom.pdfCanvas.height / 4), 0.3);
}

function rescaleRegions(ratio) {
  const sr = (r) => r ? ({ x: r.x * ratio, y: r.y * ratio, w: r.w * ratio, h: r.h * ratio }) : null;
  state.headerRegion = sr(state.headerRegion);
  state.targetRegion = sr(state.targetRegion);
  state.fixedHeaderRegion = sr(state.fixedHeaderRegion);
  state.headerRowRegion = sr(state.headerRowRegion);
  state.historyRegions = state.historyRegions.map((hr) => ({ type: hr.type, r: sr(hr.r) }));
}

function setupZoom() {
  dom.canvasContainer?.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const old = state.scale;
    state.scale = Math.min(Math.max(
      state.scale + (e.deltaY > 0 ? -0.15 : 0.15),
      getMinScale()
    ), 4);
    if (state.scale === old) return;
    rescaleRegions(state.scale / old);
    const cRect = dom.canvasContainer.getBoundingClientRect();
    const zr = state.scale / old;
    const mx = e.clientX - cRect.left;
    const my = e.clientY - cRect.top;
    dom.canvasContainer.scrollLeft = (dom.canvasContainer.scrollLeft + mx) * zr - mx;
    dom.canvasContainer.scrollTop = (dom.canvasContainer.scrollTop + my) * zr - my;
    applyZoomTransform(drawUserLines, redrawState);
    renderCropPreviewBand();
    renderEditOverlay();
  }, { passive: false });
}

// ===== Pan =====
function setupPan() {
  let _panning = false;
  let _panStart = { x: 0, y: 0 };
  dom.selectionOverlay?.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.selectionOverlay?.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      e.preventDefault();
      _panning = true;
      _panStart = { x: e.clientX, y: e.clientY };
      dom.selectionOverlay.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (_panning) {
      dom.canvasContainer.scrollLeft -= e.clientX - _panStart.x;
      dom.canvasContainer.scrollTop -= e.clientY - _panStart.y;
      _panStart = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('mouseup', () => {
    if (_panning) {
      _panning = false;
      dom.selectionOverlay.style.cursor = '';
    }
  });
}

// ===== Export =====
export function setupCanvasInteractions() {
  setupRecoveredUserLineInteractions();
  setupFallbackLineDrawing();
  setupOverlaySelection();
  setupClearLines();
  setupKeyboard();
  setupZoom();
  setupPan();
}