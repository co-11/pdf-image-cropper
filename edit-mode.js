// edit-mode.js — 編集アイテム（画像コピペ・テキスト配置）関連
import {
	state, dom, qs, showToast, overlayToCanvasPoint
} from './core.js';
import { pushExtractedImage, pushUndoSnapshot } from './pdf-workflow.js';

// ===== Edit item utilities =====
export function isCanvasEditSelectionMode() {
	return state.selectionMode === 'grid';
}

export function getCurrentEditPageNum() {
	return state.selectedPages[state.currentWorkPage] || null;
}

export function ensureEditItemsForCurrentPage() {
	const pageNum = getCurrentEditPageNum();
	if (!pageNum) return;
	if (!state.editItemsByPage[pageNum]) state.editItemsByPage[pageNum] = [];
	if (state._editPageNum !== pageNum) {
		state._editPageNum = pageNum;
		state.editItems = state.editItemsByPage[pageNum];
		state.selectedEditItemId = null;
		state.selectedEditItemIds = [];
		state.editSelectionRect = null;
		state._editDrag = null;
	}
}

export function saveEditItemsForCurrentPage() {
	const pageNum = getCurrentEditPageNum();
	if (!pageNum) return;
	state.editItemsByPage[pageNum] = state.editItems;
}

export function createEditItemId() {
	return 'edit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function cloneEditItem(item) {
	if (!item) return null;
	const cloned = JSON.parse(JSON.stringify(item));
	cloned.id = createEditItemId();
	return cloned;
}

export function getOverlayToCanvasScale() {
	if (!dom.selectionOverlay || !dom.selectionOverlay.clientWidth) return 1;
	return dom.pdfCanvas.width / dom.selectionOverlay.clientWidth;
}

export function overlayRectToCanvasRect(r) {
	const k = getOverlayToCanvasScale();
	return {
		x: Math.round(r.x * k),
		y: Math.round(r.y * k),
		w: Math.round(r.w * k),
		h: Math.round(r.h * k)
	};
}

export function getSelectedEditItem() {
	ensureEditItemsForCurrentPage();
	return state.editItems.find((item) => item.id === state.selectedEditItemId) || null;
}

export function hitTestEditItem(canvasPt) {
	if (state.drawTool !== 'select') return null;
	ensureEditItemsForCurrentPage();
	for (let i = state.editItems.length - 1; i >= 0; i--) {
		const item = state.editItems[i];
		if (
			canvasPt.x >= item.x && canvasPt.x <= item.x + item.w &&
			canvasPt.y >= item.y && canvasPt.y <= item.y + item.h
		) return item;
	}
	return null;
}

export function hitTestEditResizeHandle(canvasPt) {
	if (state.drawTool !== 'select') return null;
	const item = getSelectedEditItem();
	if (!item) return null;
	const handleSize = 18;
	const left = item.x + item.w - handleSize;
	const top = item.y + item.h - handleSize;
	if (
		canvasPt.x >= left && canvasPt.x <= left + handleSize &&
		canvasPt.y >= top && canvasPt.y <= top + handleSize
	) {
		return { id: item.id, corner: 'se' };
	}
	return null;
}
export function hitTestEditItemsInOverlayRect(r) {
	ensureEditItemsForCurrentPage();
	const cr = overlayRectToCanvasRect(r);
	const hits = [];
	for (let i = 0; i < state.editItems.length; i++) {
		const item = state.editItems[i];
		if (item.x + item.w <= cr.x || item.x >= cr.x + cr.w) continue;
		if (item.y + item.h <= cr.y || item.y >= cr.y + cr.h) continue;
		hits.push(item.id);
	}
	return hits;
}
// アスペクト比を維持したサイズ計算
export function calcAspectLockedSize(item, newW) {
  const sw = item.sourceW || item.w;
  const sh = item.sourceH || item.h;
  if (!sw || !sh) return { w: newW, h: newW };
  const ratio = sh / sw;
  return { w: Math.round(newW), h: Math.round(newW * ratio) };
}

export async function buildEditClipboardFromOverlayRect(r) {
	const cr = overlayRectToCanvasRect(r);
	if (cr.w < 2 || cr.h < 2) return null;
	const canvas = document.createElement('canvas');
	canvas.width = cr.w;
	canvas.height = cr.h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(dom.pdfCanvas, cr.x, cr.y, cr.w, cr.h, 0, 0, canvas.width, canvas.height);
	const _pn = state.selectedPages ? state.selectedPages[state.currentWorkPage] : null;
	const _eis = _pn ? (state.editItemsByPage[_pn] || []) : [];
	for (const _it of _eis) {
		const _ix = _it.x - cr.x, _iy = _it.y - cr.y;
		if (_ix + _it.w <= 0 || _iy + _it.h <= 0 || _ix >= cr.w || _iy >= cr.h) continue;
		if (_it.type === 'image' && _it.dataUrl) {
			const _im = new Image();
			await new Promise((_rv) => { _im.onload = _rv; _im.onerror = _rv; _im.src = _it.dataUrl; });
			ctx.drawImage(_im, _ix, _iy, _it.w, _it.h);
		} else if (_it.type === 'text' && _it.text) {
			ctx.save();
			ctx.font = '700 ' + (_it.fontSize || 24) + 'px "Noto Sans JP", sans-serif';
			ctx.fillStyle = _it.color || '#111827';
			ctx.textBaseline = 'middle';
			ctx.fillText(_it.text, _ix + 8, _iy + _it.h / 2);
			ctx.restore();
		}
	}
	return {
		id: createEditItemId(),
		type: 'image',
		x: 0, y: 0, w: cr.w, h: cr.h,
		sourceW: canvas.width, sourceH: canvas.height,
		dataUrl: canvas.toDataURL('image/png')
	};
}

export async function buildMultiItemClipboard() {
	ensureEditItemsForCurrentPage();
	const ids = state.selectedEditItemIds || [];
	const selected = state.editItems.filter((it) => ids.indexOf(it.id) >= 0);
	if (selected.length === 0) return null;
	let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
	for (const it of selected) {
		if (it.x < minX) minX = it.x;
		if (it.y < minY) minY = it.y;
		if (it.x + it.w > maxX) maxX = it.x + it.w;
		if (it.y + it.h > maxY) maxY = it.y + it.h;
	}
	const cw = maxX - minX, ch = maxY - minY;
	if (cw < 2 || ch < 2) return null;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(cw);
	canvas.height = Math.round(ch);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(dom.pdfCanvas, Math.round(minX), Math.round(minY), Math.round(cw), Math.round(ch), 0, 0, canvas.width, canvas.height);
	for (const it of state.editItems) {
		const ix = it.x - minX, iy = it.y - minY;
		if (ix + it.w <= 0 || iy + it.h <= 0 || ix >= cw || iy >= ch) continue;
		if (it.type === 'image' && it.dataUrl) {
			const im = new Image();
			await new Promise((rv) => { im.onload = rv; im.onerror = rv; im.src = it.dataUrl; });
			ctx.drawImage(im, ix, iy, it.w, it.h);
		} else if (it.type === 'text' && it.text) {
			ctx.save();
			ctx.font = '700 ' + (it.fontSize || 24) + 'px "Noto Sans JP", sans-serif';
			ctx.fillStyle = it.color || '#111827';
			ctx.textBaseline = 'middle';
			ctx.fillText(it.text, ix + 8, iy + it.h / 2);
			ctx.restore();
		}
	}
	return {
		id: createEditItemId(),
		type: 'image',
		x: 0, y: 0, w: Math.round(cw), h: Math.round(ch),
		sourceW: canvas.width, sourceH: canvas.height,
		dataUrl: canvas.toDataURL('image/png')
	};
}
export function getViewportCenterCanvasPoint() {
	return overlayToCanvasPoint({
		x: dom.canvasContainer.scrollLeft + (dom.canvasContainer.clientWidth / 2),
		y: dom.canvasContainer.scrollTop + (dom.canvasContainer.clientHeight / 2)
	});
}

// ===== Edit actions =====
export function pasteEditClipboardAt(canvasPt) {
	ensureEditItemsForCurrentPage();
	if (!state.editClipboard) {
		showToast('先に範囲コピーしてください');
		return;
	}
	pushUndoSnapshot();
	const item = cloneEditItem(state.editClipboard);
	item.x = Math.max(0, Math.round(canvasPt.x - item.w / 2));
	item.y = Math.max(0, Math.round(canvasPt.y - item.h / 2));
	state.editItems.push(item);
	state.selectedEditItemId = item.id;
	state.editSelectionRect = null;
	saveEditItemsForCurrentPage();
	setEditTool('select');
	renderEditOverlay();
	showToast('貼り付けました');
}

export function addEditTextAt(canvasPt, text) {
	ensureEditItemsForCurrentPage();
	if (!text) {
		showToast('配置するテキストを入力してください');
		return;
	}
	pushUndoSnapshot();
	const measureCanvas = document.createElement('canvas');
	const measureCtx = measureCanvas.getContext('2d');
	const fontSize = 24;
	measureCtx.font = '700 ' + fontSize + 'px "Noto Sans JP", sans-serif';
	const textWidth = Math.ceil(measureCtx.measureText(text).width);
	const item = {
		id: createEditItemId(),
		type: 'text', text,
		x: Math.max(0, Math.round(canvasPt.x)),
		y: Math.max(0, Math.round(canvasPt.y)),
		w: textWidth + 16, h: fontSize + 12,
		fontSize, color: '#111827'
	};
	state.editItems.push(item);
	state.selectedEditItemId = item.id;
	saveEditItemsForCurrentPage();
	setEditTool('select');
	renderEditOverlay();
	showToast('文字を配置しました');
}
// ★ PDF上でインラインテキスト入力
export function showInlineTextInput(overlayPt, canvasPt) {
	dom.selectionOverlay?.querySelector('.edit-inline-text-input')?.remove();
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'edit-inline-text-input';
	input.placeholder = 'テキストを入力…';
	Object.assign(input.style, {
		position: 'absolute',
		left: overlayPt.x + 'px',
		top: overlayPt.y + 'px',
		minWidth: '120px',
		padding: '4px 8px',
		fontSize: '14px',
		fontWeight: '700',
		fontFamily: '"Noto Sans JP", sans-serif',
		background: 'rgba(255,255,255,0.95)',
		border: '2px solid #3b82f6',
		borderRadius: '4px',
		outline: 'none',
		zIndex: '50',
		color: '#111827',
		boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
	});
	const confirm = () => {
		const text = input.value.trim();
		if (input.parentNode) input.remove();
		if (text) {
			addEditTextAt(canvasPt, text);
		} else {
			setEditTool('select');
		}
	};
	input.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			confirm();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			input.remove();
			setEditTool('select');
		}
	});
	input.addEventListener('blur', () => {
		setTimeout(() => { if (input.parentNode) confirm(); }, 100);
	});
	dom.selectionOverlay.appendChild(input);
	requestAnimationFrame(() => input.focus());
}

export function removeSelectedEditItem() {
	ensureEditItemsForCurrentPage();
	pushUndoSnapshot();
	const _ids = (state.selectedEditItemIds && state.selectedEditItemIds.length)
		? state.selectedEditItemIds.slice()
		: (state.selectedEditItemId ? [state.selectedEditItemId] : []);
	if (_ids.length === 0) return;
	for (let i = state.editItems.length - 1; i >= 0; i--) {
		if (_ids.indexOf(state.editItems[i].id) >= 0) state.editItems.splice(i, 1);
	}
	state.selectedEditItemId = null;
	state.selectedEditItemIds = [];
	saveEditItemsForCurrentPage();
	renderEditOverlay();
	showToast('編集アイテムを削除しました');
}

// ===== Edit tool =====
export function syncDrawToolUi() {
	// インライン入力に移行したためツールバーのテキスト入力欄は常に非表示
	const textSetting = qs('#editTextSettingItem');
	if (textSetting) textSetting.style.display = 'none';
}

export function setEditTool(tool) {
	state.drawTool = tool;
	state.isDrawingLine = tool === 'line' || tool === 'rect';
	state._toolDrag = null;
	state._lineStartCanvas = null;
	state._cropDrag = null;
	state._cropPreview = null;
	dom.selectionOverlay?.querySelector('.crop-preview-band')?.remove();
	if (dom.btnCropExec) dom.btnCropExec.style.display = 'none';
	qs('#drawToolGroup')?.querySelectorAll('[data-tool]').forEach((btn) => {
		if (tool === 'crop' && btn.dataset.tool === 'crop') {
			btn.classList.toggle('active', btn.dataset.direction === state.cropDirection);
		} else {
			btn.classList.toggle('active', btn.dataset.tool === tool);
		}
	});
	syncDrawToolUi();
	renderEditOverlay();
}

// ===== ★ renderEditOverlay — 全モードで編集アイテムを表示 ★ =====
export function renderEditOverlay() {
	const isCanvasEdit = isCanvasEditSelectionMode();
	const editToolGroup = qs('#drawToolGroup');
	const editTextSettingItem = qs('#editTextSettingItem');

	// 描画ツールグループはgridモードのみ表示
	if (editToolGroup) editToolGroup.style.display = isCanvasEdit ? 'inline-flex' : 'none';
	if (editTextSettingItem) editTextSettingItem.style.display = 'none';

	if (!dom.selectionOverlay) return;
	ensureEditItemsForCurrentPage();

	// 既存の編集レイヤーを除去
	dom.selectionOverlay.querySelectorAll('.edit-item-layer, .edit-selection-rect, .edit-resize-handle').forEach((el) => el.remove());

	// gridモード時のみ、他のUI要素を非表示にする
	if (isCanvasEdit) {
		const selectMethodWrap = qs('#selectMethodGroup')?.closest('.setting-item');
		const borderSettingItem = qs('#borderSettingItem');
		if (selectMethodWrap) selectMethodWrap.style.display = 'none';
		if (borderSettingItem) borderSettingItem.style.display = 'none';
		if (dom.positionSettingItem) dom.positionSettingItem.style.display = 'none';
		if (dom.singleExtractReadSettingItem) dom.singleExtractReadSettingItem.style.display = 'none';
		if (dom.singleExtractTextPositionSettingItem) dom.singleExtractTextPositionSettingItem.style.display = 'none';
		if (dom.btnSelectFixedHeader) dom.btnSelectFixedHeader.style.display = 'none';
		if (dom.btnSelectHeader) dom.btnSelectHeader.style.display = 'none';
		if (dom.btnSelectHeaderRow) dom.btnSelectHeaderRow.style.display = 'none';
		if (dom.btnSelectTarget) dom.btnSelectTarget.style.display = 'none';
		if (dom.btnClearHeader) dom.btnClearHeader.style.display = 'none';
	}

	const k = getOverlayToCanvasScale();
	const toOverlay = (v) => v / k;

	state.editItems.forEach((item) => {
		const left = toOverlay(item.x);
		const top = toOverlay(item.y);
		const width = toOverlay(item.w);
		const height = toOverlay(item.h);
		const el = document.createElement('div');
		el.className = 'edit-item-layer';
		el.dataset.editId = item.id;
		el.style.position = 'absolute';
		el.style.left = left + 'px';
		el.style.top = top + 'px';
		el.style.width = width + 'px';
		el.style.height = height + 'px';
		el.style.pointerEvents = 'none';
		el.style.boxSizing = 'border-box';
		el.style.zIndex = '20';

		// gridモード: 選択枠表示、非gridモード: 枠なしで表示のみ
		if (isCanvasEdit) {
			const _isSel = item.id === state.selectedEditItemId || (state.selectedEditItemIds && state.selectedEditItemIds.indexOf(item.id) >= 0);
			el.style.border = _isSel
				? '2px solid #3b82f6'
				: '1px dashed rgba(59,130,246,0.65)';
			el.style.background = 'rgba(255,255,255,0.2)';
		} else {
			el.style.border = 'none';
			el.style.background = 'transparent';
		}

		if (item.type === 'image') {
			el.style.backgroundImage = `url(${item.dataUrl})`;
			el.style.backgroundRepeat = 'no-repeat';
			el.style.backgroundPosition = 'center';
			el.style.backgroundSize = '100% 100%';
			el.style.backgroundColor = '#ffffff';
		} else {
			el.textContent = item.text || '';
			el.style.display = 'flex';
			el.style.alignItems = 'center';
			el.style.justifyContent = 'center';
			el.style.padding = Math.max(2, toOverlay(8)) + 'px';
			el.style.fontSize = Math.max(10, toOverlay(item.fontSize || 24)) + 'px';
			el.style.fontWeight = '700';
			el.style.color = item.color || '#111827';
			el.style.background = 'rgba(255,255,255,0.85)';
		}
		dom.selectionOverlay.appendChild(el);

		// リサイズハンドルはgridモードのみ
		if (isCanvasEdit && item.id === state.selectedEditItemId) {
			const handle = document.createElement('div');
			handle.className = 'edit-resize-handle';
			handle.style.position = 'absolute';
			handle.style.left = (left + width - 10) + 'px';
			handle.style.top = (top + height - 10) + 'px';
			handle.style.width = '12px';
			handle.style.height = '12px';
			handle.style.borderRadius = '999px';
			handle.style.background = '#3b82f6';
			handle.style.border = '2px solid #ffffff';
			handle.style.boxShadow = '0 0 0 1px rgba(59,130,246,0.35)';
			handle.style.pointerEvents = 'none';
			handle.style.zIndex = '22';
			dom.selectionOverlay.appendChild(handle);
		}
	});

	// 選択矩形はgridモードのみ
	if (isCanvasEdit && state.editSelectionRect && state.editSelectionRect.w > 1 && state.editSelectionRect.h > 1) {
		const rectEl = document.createElement('div');
		const selClass = state.drawTool === 'copy' ? 'copy-sel' : 'edit-sel';
		rectEl.className = 'selection-rect ' + selClass + ' edit-selection-rect';
		rectEl.style.left = state.editSelectionRect.x + 'px';
		rectEl.style.top = state.editSelectionRect.y + 'px';
		rectEl.style.width = state.editSelectionRect.w + 'px';
		rectEl.style.height = state.editSelectionRect.h + 'px';
		rectEl.style.zIndex = '21';
		dom.selectionOverlay.appendChild(rectEl);
	}
}

// ===== Canvas image sync (変更なし、既に全モード対応) =====
let _selectedImageOverlayRaf = 0;

export function setupSelectedImageOverlayFrame() {
	if (!dom.canvasContainer) return;
	if (dom.canvasContainer.dataset.selectedImageOverlayBound === 'true') return;
	dom.canvasContainer.dataset.selectedImageOverlayBound = 'true';
	const isTransparent = (color) => {
		return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
	};
	const isLikelySelectedElement = (el, cs) => {
		const cls = String(el.className || '');
		if (/selected|active/i.test(cls)) return true;
		for (const [key, value] of Object.entries(el.dataset || {})) {
			if (/selected|active/i.test(String(key)) || String(value) === 'true' || /selected|active/i.test(String(value))) return true;
		}
		const borderWidth = parseFloat(cs.borderWidth || '0');
		return borderWidth > 0 && !isTransparent(cs.borderColor);
	};
	const ensureFrameLayer = () => {
		let layer = dom.canvasContainer.querySelector('[data-selection-frame-layer="true"]');
		if (!layer) {
			layer = document.createElement('div');
			layer.dataset.selectionFrameLayer = 'true';
			Object.assign(layer.style, {
				position: 'absolute', left: '0', top: '0',
				width: '100%', height: '100%',
				pointerEvents: 'none', zIndex: '40'
			});
			dom.canvasContainer.appendChild(layer);
		}
		return layer;
	};
	const clearOverlayFrame = (node) => {
		['border-width', 'border-style', 'border-color', 'outline', 'outline-offset', 'box-sizing'].forEach((p) => node.style.removeProperty(p));
		delete node.dataset.overlaySelectionStyled;
	};
	const applyOverlayFrame = () => {
		_selectedImageOverlayRaf = 0;
		const layer = ensureFrameLayer();
		layer.innerHTML = '';
		dom.canvasContainer.querySelectorAll('[data-overlay-selection-styled="true"]').forEach((node) => {
			if (node instanceof HTMLElement) clearOverlayFrame(node);
		});
		const containerRect = dom.canvasContainer.getBoundingClientRect();
		dom.canvasContainer.querySelectorAll('*').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const cs = window.getComputedStyle(node);
			const hasVisualContent = node.tagName === 'IMG' || node.tagName === 'CANVAS' || !!node.querySelector('img, canvas');
			if (!hasVisualContent || !isLikelySelectedElement(node, cs)) return;
			const borderWidth = Math.max(2, Math.round(parseFloat(cs.borderWidth || '0') || 0));
			const borderColor = isTransparent(cs.borderColor) ? 'rgb(59, 130, 246)' : cs.borderColor;
			node.style.setProperty('border-width', '0px', 'important');
			node.style.setProperty('border-style', 'solid', 'important');
			node.style.setProperty('border-color', 'transparent', 'important');
			node.style.setProperty('outline', 'none', 'important');
			node.style.setProperty('outline-offset', '0', 'important');
			node.style.setProperty('box-sizing', 'content-box', 'important');
			node.dataset.overlaySelectionStyled = 'true';
			const nodeRect = node.getBoundingClientRect();
			const frame = document.createElement('div');
			frame.dataset.selectionOverlayFrame = 'true';
			Object.assign(frame.style, {
				position: 'absolute',
				left: `${nodeRect.left - containerRect.left + dom.canvasContainer.scrollLeft}px`,
				top: `${nodeRect.top - containerRect.top + dom.canvasContainer.scrollTop}px`,
				width: `${nodeRect.width}px`,
				height: `${nodeRect.height}px`,
				boxSizing: 'border-box',
				border: `${borderWidth}px solid ${borderColor}`,
				borderRadius: cs.borderRadius || '0px',
				pointerEvents: 'none'
			});
			layer.appendChild(frame);
		});
	};
	const scheduleApply = () => {
		if (_selectedImageOverlayRaf) cancelAnimationFrame(_selectedImageOverlayRaf);
		_selectedImageOverlayRaf = requestAnimationFrame(applyOverlayFrame);
	};
	window.scheduleSelectedImageOverlayFrame = scheduleApply;
	const observer = new MutationObserver(scheduleApply);
	observer.observe(dom.canvasContainer, {
		childList: true, subtree: true, attributes: true,
		attributeFilter: ['class', 'style', 'data-selected', 'data-active']
	});
	dom.canvasContainer.addEventListener('scroll', scheduleApply, { passive: true });
	window.addEventListener('resize', scheduleApply);
	scheduleApply();
}

export function scheduleSelectedImageOverlayFrame() {
	if (typeof window.scheduleSelectedImageOverlayFrame === 'function') {
		window.scheduleSelectedImageOverlayFrame();
	}
}

export function syncPersistentCanvasImages() {
	if (!dom.canvasContainer) return;
	const isEditMode = state.selectionMode === 'grid';
	const knownImageUrls = new Set(
		(state.extractedImages || [])
			.map((item) => item?.dataUrl)
			.filter((url) => typeof url === 'string' && url)
	);
	dom.canvasContainer.querySelectorAll('*').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const hasVisualContent =
			node.tagName === 'IMG' ||
			node.tagName === 'CANVAS' ||
			!!node.querySelector('img, canvas');
		if (!hasVisualContent) return;
		node.classList.remove('hidden');
		node.hidden = false;
		node.style.setProperty('visibility', 'visible', 'important');
		node.style.setProperty('opacity', '1', 'important');
		if (node.tagName === 'IMG' || node.tagName === 'CANVAS') {
			node.style.setProperty('display', 'block', 'important');
			node.style.setProperty('z-index', '20', 'important');
			node.style.setProperty('border-width', '0px', 'important');
			node.style.setProperty('border-style', 'solid', 'important');
			node.style.setProperty('border-color', 'transparent', 'important');
			node.style.setProperty('outline', 'none', 'important');
			node.style.setProperty('outline-offset', '0', 'important');
			node.style.setProperty('box-sizing', 'content-box', 'important');
		}
		if (node instanceof HTMLImageElement) {
			node.style.pointerEvents = isEditMode ? '' : 'none';
			const src = node.currentSrc || node.src || '';
			if (src.startsWith('data:image/') && !knownImageUrls.has(src)) {
				knownImageUrls.add(src);
				pushExtractedImage(src);
			}
		}
	});
	scheduleSelectedImageOverlayFrame();
}

export function setupPersistentCanvasImageVisibility() {
	if (!dom.canvasContainer) return;
	if (dom.canvasContainer.dataset.persistentCanvasImageBound === 'true') return;
	dom.canvasContainer.dataset.persistentCanvasImageBound = 'true';
	const scheduleSync = () => requestAnimationFrame(syncPersistentCanvasImages);
	const observer = new MutationObserver(scheduleSync);
	observer.observe(dom.canvasContainer, {
		childList: true, subtree: true, attributes: true,
		attributeFilter: ['class', 'style', 'hidden']
	});
	window.addEventListener('resize', scheduleSync);
	scheduleSync();
}

export function getEditCursorForPoint(canvasPt) {
  if (hitTestEditResizeHandle(canvasPt)) return 'nwse-resize';
  if (hitTestEditItem(canvasPt)) return 'move';
  return null;
}