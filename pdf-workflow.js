// pdf-workflow.js
import {
	state,
	dom,
	showToast,
	showStep,
	getCurrentListName,
	getNextSeqNum,
	renumberImages,
	sanitizeFileBaseName,
	clearAllOverlays,
	toCanvasCoords,
	applyZoomTransform,
	_renderScale,
	setRenderScale
} from './core.js';

// ===== Common UI =====
export function updatePageControls() {
	const selected = state.pages.filter((p) => p.selected);
	if (dom.pageIndicator) {
		dom.pageIndicator.textContent = `${selected.length} / ${state.pages.length} 選択中`;
	}
	if (dom.goToStep3) {
		dom.goToStep3.disabled = selected.length === 0;
	}
}

export function updateModeButtons() {
	if (dom.btnSelectHeader) {
		dom.btnSelectHeader.classList.toggle('active', state.mode === 'header');
	}
	if (dom.btnSelectTarget) {
		dom.btnSelectTarget.classList.toggle(
			'active',
			state.mode === 'target' || state.mode === 'manual' || state.mode === 'single'
		);
	}
	if (dom.btnSelectHeaderRow) {
		dom.btnSelectHeaderRow.classList.toggle('active', state.mode === 'headerRow');
	}
	if (dom.btnSelectFixedHeader) {
		dom.btnSelectFixedHeader.classList.toggle('active', state.mode === 'fixedHeader');
	}
	if (dom.btnSettingsToggle) {
		dom.btnSettingsToggle.disabled = state.selectMethod === 'manual';
	}
}

export function redrawState() {
	state.historyRegions.forEach((hr) => {
		const el = document.createElement('div');
		el.className =
			'selection-rect history-rect ' +
			(hr.type === 'header'
				? 'header-sel'
				: hr.type === 'fixedHeader'
					? 'fixed-header-sel'
					: hr.type === 'headerRow'
						? 'header-row-sel'
						: 'target-sel') +
			' confirmed';

		el.style.left = hr.r.x + 'px';
		el.style.top = hr.r.y + 'px';
		el.style.width = hr.r.w + 'px';
		el.style.height = hr.r.h + 'px';
		dom.selectionOverlay.appendChild(el);
	});

	function upsert(region, cls, tag) {
		let el = dom.selectionOverlay.querySelector(`[data-region="${tag}"]`);
		if (!region) {
			if (el) el.remove();
			return;
		}
		if (!el) {
			el = document.createElement('div');
			el.className = 'selection-rect ' + cls;
			el.dataset.region = tag;
			dom.selectionOverlay.appendChild(el);
		}
		el.style.left = region.x + 'px';
		el.style.top = region.y + 'px';
		el.style.width = region.w + 'px';
		el.style.height = region.h + 'px';
	}

	upsert(state.headerRegion, 'header-sel confirmed', 'header');
	upsert(state.targetRegion, 'target-sel confirmed', 'target');
	upsert(state.fixedHeaderRegion, 'fixed-header-sel confirmed', 'fixedHeader');
	upsert(state.headerRowRegion, 'header-row-sel confirmed', 'headerRow');
}

export function getOverlayCoords(e) {
	const rect = dom.selectionOverlay.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function calcRect(a, b) {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y)
	};
}

export function drawRect(r, cls) {
	const el = document.createElement('div');
	el.className = 'selection-rect ' + cls;
	el.style.left = r.x + 'px';
	el.style.top = r.y + 'px';
	el.style.width = r.w + 'px';
	el.style.height = r.h + 'px';
	dom.selectionOverlay.appendChild(el);
}

// ===== Grid =====
export function clusterLines(lines, gap) {
	if (lines.length === 0) return [];
	lines.sort((a, b) => a - b);

	const clusters = [];
	let sum = lines[0];
	let count = 1;

	for (let i = 1; i < lines.length; i++) {
		if (lines[i] - lines[i - 1] <= gap) {
			sum += lines[i];
			count++;
		} else {
			clusters.push(Math.round(sum / count));
			sum = lines[i];
			count = 1;
		}
	}
	clusters.push(Math.round(sum / count));
	return clusters;
}

export async function detectLines(region) {
	let threshold = parseInt(dom.gridThreshold.value, 10);
	let minLen = parseInt(dom.minLineLen.value, 10);

	const cr = toCanvasCoords(region);
	const rx = Math.round(cr.x);
	const ry = Math.round(cr.y);
	const rw = Math.round(cr.w);
	const rh = Math.round(cr.h);

	minLen = Math.min(minLen, Math.max(rw, rh));

	// PDF + 編集アイテムを合成したtemp canvasで罫線検出
	const _tc = document.createElement('canvas');
	_tc.width = rw;
	_tc.height = rh;
	const _tctx = _tc.getContext('2d', { willReadFrequently: true });
	_tctx.drawImage(dom.pdfCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
	const _pn = state.selectedPages ? state.selectedPages[state.currentWorkPage] : null;
	const _eis = _pn ? (state.editItemsByPage[_pn] || []) : [];
	for (const _it of _eis) {
		const _ix = _it.x - rx, _iy = _it.y - ry;
		if (_ix + _it.w <= 0 || _iy + _it.h <= 0 || _ix >= rw || _iy >= rh) continue;
		if (_it.type === 'image' && _it.dataUrl) {
			const _im = new Image();
			await new Promise((_rv) => { _im.onload = _rv; _im.onerror = _rv; _im.src = _it.dataUrl; });
			_tctx.drawImage(_im, _ix, _iy, _it.w, _it.h);
		} else if (_it.type === 'text' && _it.text) {
			_tctx.save();
			_tctx.font = '700 ' + (_it.fontSize || 24) + 'px "Noto Sans JP", sans-serif';
			_tctx.fillStyle = _it.color || '#111827';
			_tctx.textBaseline = 'middle';
			_tctx.fillText(_it.text, _ix + 8, _iy + _it.h / 2);
			_tctx.restore();
		}
	}
	const imgData = _tctx.getImageData(0, 0, rw, rh);
	const d = imgData.data;
	const w = rw;
	const h = rh;

	const dark = new Uint8Array(w * h);

	for (let i = 0; i < w * h; i++) {
		const r = d[i * 4];
		const g = d[i * 4 + 1];
		const b = d[i * 4 + 2];
		dark[i] = ((r + g + b) / 3) < threshold ? 1 : 0;
	}

	if (state.userLines && state.userLines.length) {
		const lw = 2;

		function setDarkLocal(x, y) {
			if (x < 0 || y < 0 || x >= w || y >= h) return;
			dark[y * w + x] = 1;
		}

		for (let li = 0; li < state.userLines.length; li++) {
			const L = state.userLines[li];
			const x1 = Math.round(L.x1 - rx);
			const y1 = Math.round(L.y1 - ry);
			const x2 = Math.round(L.x2 - rx);
			const y2 = Math.round(L.y2 - ry);

			if (
				(x1 < 0 && x2 < 0) ||
				(x1 >= w && x2 >= w) ||
				(y1 < 0 && y2 < 0) ||
				(y1 >= h && y2 >= h)
			) continue;

			if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
				const yy = Math.max(0, Math.min(h - 1, Math.round((y1 + y2) / 2)));
				const sx = Math.max(0, Math.min(w - 1, Math.min(x1, x2)));
				const ex = Math.max(0, Math.min(w - 1, Math.max(x1, x2)));

				for (let x = sx; x <= ex; x++) {
					for (let t = -lw; t <= lw; t++) setDarkLocal(x, yy + t);
				}
			} else {
				const xx = Math.max(0, Math.min(w - 1, Math.round((x1 + x2) / 2)));
				const sy = Math.max(0, Math.min(h - 1, Math.min(y1, y2)));
				const ey = Math.max(0, Math.min(h - 1, Math.max(y1, y2)));

				for (let y = sy; y <= ey; y++) {
					for (let t = -lw; t <= lw; t++) setDarkLocal(xx + t, y);
				}
			}
		}
	}

	let hLines = [];
	let vLines = [];

	for (let y = 0; y < h; y++) {
		let run = 0;
		for (let x = 0; x < w; x++) {
			if (dark[y * w + x]) run++;
			else {
				if (run >= minLen) {
					hLines.push(y);
					break;
				}
				run = 0;
			}
		}
		if (run >= minLen) hLines.push(y);
	}

	for (let x = 0; x < w; x++) {
		let run = 0;
		for (let y = 0; y < h; y++) {
			if (dark[y * w + x]) run++;
			else {
				if (run >= minLen) {
					vLines.push(x);
					break;
				}
				run = 0;
			}
		}
		if (run >= minLen) vLines.push(x);
	}

	hLines = clusterLines(hLines, 5);
	vLines = clusterLines(vLines, 5);

	const oR = state.scale / _renderScale;
	for (let i = 0; i < hLines.length; i++) hLines[i] = Math.round(hLines[i] * oR);
	for (let i = 0; i < vLines.length; i++) vLines[i] = Math.round(vLines[i] * oR);

	return {
		hLines,
		vLines,
		rx: Math.round(region.x),
		ry: Math.round(region.y),
		rw: Math.round(region.w),
		rh: Math.round(region.h)
	};
}

export function linesToCells(lineResult) {
	const { hLines, vLines, rx, ry } = lineResult;
	if (hLines.length < 2 || vLines.length < 2) return [];

	const cells = [];
	for (let row = 0; row < hLines.length - 1; row++) {
		for (let col = 0; col < vLines.length - 1; col++) {
			const cellW = vLines[col + 1] - vLines[col];
			const cellH = hLines[row + 1] - hLines[row];
			if (cellW > 3 && cellH > 3) {
				cells.push({
					x: rx + vLines[col],
					y: ry + hLines[row],
					w: cellW,
					h: cellH,
					row,
					col
				});
			}
		}
	}
	return cells;
}

export function cellsBoundingBox(cells) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = 0;
	let maxY = 0;

	for (let i = 0; i < cells.length; i++) {
		const c = cells[i];
		if (c.x < minX) minX = c.x;
		if (c.y < minY) minY = c.y;
		if (c.x + c.w > maxX) maxX = c.x + c.w;
		if (c.y + c.h > maxY) maxY = c.y + c.h;
	}

	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ===== Image =====
export function cropCell(cell) {
	const cc = toCanvasCoords(cell);
	const c = document.createElement('canvas');
	c.width = Math.round(cc.w);
	c.height = Math.round(cc.h);

	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.drawImage(dom.pdfCanvas, cc.x, cc.y, cc.w, cc.h, 0, 0, c.width, c.height);
	return c;
}

export function combineImages(hdrCanvas, tgtCanvas, position) {
	const hw = hdrCanvas.width;
	const hh = hdrCanvas.height;
	const tw = tgtCanvas.width;
	const th = tgtCanvas.height;
	let cw, ch, hx, hy, tx, ty;

	switch (position) {
		case 'top':
			cw = Math.max(hw, tw);
			ch = hh + th;
			hx = (cw - hw) / 2;
			hy = 0;
			tx = (cw - tw) / 2;
			ty = hh;
			break;
		case 'bottom':
			cw = Math.max(hw, tw);
			ch = th + hh;
			tx = (cw - tw) / 2;
			ty = 0;
			hx = (cw - hw) / 2;
			hy = th;
			break;
		case 'right':
			cw = tw + hw;
			ch = Math.max(hh, th);
			tx = 0;
			ty = (ch - th) / 2;
			hx = tw;
			hy = (ch - hh) / 2;
			break;
		case 'left':
		default:
			cw = hw + tw;
			ch = Math.max(hh, th);
			hx = 0;
			hy = (ch - hh) / 2;
			tx = hw;
			ty = (ch - th) / 2;
			break;
	}

	const combined = document.createElement('canvas');
	combined.width = cw;
	combined.height = ch;

	const ctx = combined.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, cw, ch);
	ctx.drawImage(hdrCanvas, hx, hy);
	ctx.drawImage(tgtCanvas, tx, ty);

	if (state.addBorder) {
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 2;
		ctx.strokeRect(1, 1, cw - 2, ch - 2);
	}

	return combined;
}

export function combineWithHeaderRow(hCol, hRow, tgt, pos, cnr) {
	let cw, ch;
	const combined = document.createElement('canvas');

	if (pos === 'left' || pos === 'right') {
		cw = hCol.width + tgt.width;
		ch = hRow.height + tgt.height;
	} else {
		cw = Math.max(hRow.width, tgt.width);
		ch = hCol.height + hRow.height + tgt.height;
	}

	combined.width = cw;
	combined.height = ch;

	const ctx = combined.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, cw, ch);

	if (pos === 'left') {
		if (cnr) ctx.drawImage(cnr, 0, 0, hCol.width, hRow.height);
		ctx.drawImage(hRow, hCol.width, 0);
		ctx.drawImage(hCol, 0, hRow.height);
		ctx.drawImage(tgt, hCol.width, hRow.height);
	} else if (pos === 'right') {
		if (cnr) ctx.drawImage(cnr, tgt.width, 0, hCol.width, hRow.height);
		ctx.drawImage(hRow, 0, 0);
		ctx.drawImage(tgt, 0, hRow.height);
		ctx.drawImage(hCol, tgt.width, hRow.height);
	} else if (pos === 'top') {
		if (cnr) ctx.drawImage(cnr, 0, 0);
		ctx.drawImage(hCol, 0, 0);
		ctx.drawImage(hRow, 0, hCol.height);
		ctx.drawImage(tgt, 0, hCol.height + hRow.height);
	} else {
		if (cnr) ctx.drawImage(cnr, 0, 0);
		ctx.drawImage(hRow, 0, 0);
		ctx.drawImage(tgt, 0, hRow.height);
		ctx.drawImage(hCol, 0, hRow.height + tgt.height);
	}

	if (state.addBorder) {
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 2;
		ctx.strokeRect(1, 1, cw - 2, ch - 2);
	}

	return combined;
}

// ===== Text extraction =====
export async function extractEdgeTextFromRegion(pageNum, regionOverlay, position = 'top') {
	if (!state.pdfDoc) return '';
	const page = await state.pdfDoc.getPage(pageNum);
	const vp = page.getViewport({ scale: _renderScale });
	const tc = await page.getTextContent();
	const items = tc.items || [];
	const cr = toCanvasCoords(regionOverlay);
	const rx = cr.x;
	const ry = cr.y;
	const rw = cr.w;
	const rh = cr.h;
	const hitTexts = [];
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (!it.str) continue;
		const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
		const x = tx[4];
		const y = tx[5];
		const h = Math.hypot(tx[2], tx[3]);
		const w = it.width || Math.hypot(tx[0], tx[1]);
		const box = { x, y: y - h, w, h: h * 1.2, right: x + w, bottom: y - h + h * 1.2 };
		const intersects = !(
			box.x + box.w < rx ||
			box.x > rx + rw ||
			box.y + box.h < ry ||
			box.y > ry + rh
		);
		if (intersects) hitTexts.push({ str: it.str, x: box.x, y: box.y, right: box.right, bottom: box.bottom });
	}
	if (hitTexts.length === 0) return '';
	let filtered = [];
	if (position === 'bottom') {
		const bottomY = Math.max(...hitTexts.map((t) => t.bottom));
		filtered = hitTexts
			.filter((t) => Math.abs(t.bottom - bottomY) <= 5)
			.sort((a, b) => a.x - b.x);
	} else if (position === 'left') {
		const leftX = Math.min(...hitTexts.map((t) => t.x));
		filtered = hitTexts
			.filter((t) => Math.abs(t.x - leftX) <= 5)
			.sort((a, b) => {
				const dy = a.y - b.y;
				if (Math.abs(dy) > 5) return dy;
				return a.x - b.x;
			});
	} else if (position === 'right') {
		const rightX = Math.max(...hitTexts.map((t) => t.right));
		filtered = hitTexts
			.filter((t) => Math.abs(t.right - rightX) <= 5)
			.sort((a, b) => {
				const dy = a.y - b.y;
				if (Math.abs(dy) > 5) return dy;
				return a.x - b.x;
			});
	} else {
		const topY = Math.min(...hitTexts.map((t) => t.y));
		filtered = hitTexts
			.filter((t) => Math.abs(t.y - topY) <= 5)
			.sort((a, b) => a.x - b.x);
	}
	return filtered.map((t) => t.str).join(' ');
}
export async function extractDrawingName(pageNum) {
	try {
		const page = await state.pdfDoc.getPage(pageNum);
		const tc = await page.getTextContent();
		const items = tc.items;

		const ti = [];
		for (let i = 0; i < items.length; i++) {
			const tr = items[i].transform;
			const s = items[i].str;
			if (s) ti.push({ str: s, x: tr[4], y: tr[5], w: items[i].width || 0 });
		}

		const LABEL = '図面名称';
		let labelItem = null;

		for (let i = 0; i < ti.length; i++) {
			if (ti[i].str.replace(/[\s\u3000]/g, '').includes(LABEL)) {
				labelItem = ti[i];
				break;
			}
		}

		if (!labelItem) return null;

		const labelY = labelItem.y;
		const labelRight = labelItem.x + labelItem.w;
		const candidates = [];

		for (let i = 0; i < ti.length; i++) {
			const s = ti[i].str.trim();
			const sc = s.replace(/[\s\u3000]/g, '');
			if (!s || s.length < 2) continue;
			if (sc.includes(LABEL)) continue;
			if (sc.includes('図面番号')) continue;
			if (sc === '記事' || sc === '訂正' || sc === 'SCALE') continue;
			if (/^[\d.\-\/]+$/.test(sc)) continue;

			if (Math.abs(ti[i].y - labelY) < 15 && ti[i].x >= labelItem.x) {
				candidates.push({ str: s, dist: Math.abs(ti[i].x - labelRight) });
			}
		}

		candidates.sort((a, b) => a.dist - b.dist);

		const KEYWORDS = /リスト|伏図|詳細|軸組|断面|配筋|展開|配置|立面/;
		for (let i = 0; i < candidates.length; i++) {
			if (KEYWORDS.test(candidates[i].str)) return candidates[i].str;
		}
		if (candidates.length > 0) return candidates[0].str;

		return null;
	} catch (err) {
		console.warn('extractDrawingName error on page ' + pageNum, err);
		return null;
	}
}

// ===== PDF loading =====
export function handleFile(file) {
	if (!file || file.type !== 'application/pdf') {
		showToast('PDFファイルを選択してください');
		return;
	}

	const reader = new FileReader();
	reader.onload = async (e) => {
		try {
			state.pdfDoc = await pdfjsLib.getDocument({
				data: new Uint8Array(e.target.result)
			}).promise;
			showStep(2);
			await initPages();
		} catch (err) {
			showToast('PDFの読み込みに失敗しました');
		}
	};
	reader.readAsArrayBuffer(file);
}

export async function initPages() {
	state.pages = [];
	state.lastClickedIndex = -1;
	dom.pageThumbnails.innerHTML = '';
	dom.loadingInfo.classList.remove('hidden');

	try {
		for (let i = 1; i <= state.pdfDoc.numPages; i++) {
			const name = await extractDrawingName(i);
			state.pages.push({
				pageNum: i,
				selected: name ? name.includes('リスト') : false,
				drawingName: name || ''
			});
		}
	} finally {
		dom.loadingInfo.classList.add('hidden');
	}

	await renderThumbnails();
	updatePageControls();

	const listCount = state.pages.filter((p) => p.selected).length;
	if (listCount > 0) {
		showToast(`「リスト」を含む ${listCount} ページを自動選択しました`);
	}
}

export async function renderThumbnails() {
	dom.pageThumbnails.innerHTML = '';

	for (let idx = 0; idx < state.pages.length; idx++) {
		const p = state.pages[idx];
		const page = await state.pdfDoc.getPage(p.pageNum);
		const vp = page.getViewport({ scale: 0.3 });

		const div = document.createElement('div');
		div.className = 'page-thumb' + (p.selected ? ' selected' : '');
		div.dataset.index = idx;

		const imgContainer = document.createElement('div');
		imgContainer.className = 'page-thumb-image-container';

		const canvas = document.createElement('canvas');
		canvas.width = vp.width;
		canvas.height = vp.height;

		await page.render({
			canvasContext: canvas.getContext('2d', { willReadFrequently: true }),
			viewport: vp
		}).promise;

		imgContainer.appendChild(canvas);

		const info = document.createElement('div');
		info.className = 'page-thumb-info';
		info.innerHTML =
			`<div class="page-thumb-label">P.${p.pageNum}</div>` +
			`<div class="page-thumb-name" title="${p.drawingName || '名称なし'}">${p.drawingName || '-'}</div>`;

		div.appendChild(imgContainer);
		div.appendChild(info);

		div.addEventListener('click', (e) => handleThumbClick(idx, e));
		dom.pageThumbnails.appendChild(div);
	}
}

export function handleThumbClick(index, event) {
	if (event.shiftKey && state.lastClickedIndex >= 0) {
		const start = Math.min(state.lastClickedIndex, index);
		const end = Math.max(state.lastClickedIndex, index);
		for (let i = start; i <= end; i++) state.pages[i].selected = true;
	} else {
		state.pages[index].selected = !state.pages[index].selected;
	}
	state.lastClickedIndex = index;
	updateThumbnailStyles();
	updatePageControls();
}

export function updateThumbnailStyles() {
	for (let i = 0; i < state.pages.length; i++) {
		const el = dom.pageThumbnails.querySelector(`[data-index="${i}"]`);
		if (el) el.classList.toggle('selected', state.pages[i].selected);
	}
}

export async function renderWorkPage() {
	const pageNum = state.selectedPages[state.currentWorkPage];
	state.userLines = state.userLinesByPage[pageNum] || [];

	dom.listNameInput.value = getCurrentListName();
	dom.currentPageLabel.textContent = `${state.currentWorkPage + 1} / ${state.selectedPages.length}`;

	const currentName = getCurrentListName();
	const names = {};
	state.extractedImages.forEach((img) => { names[img.listName] = true; });

	for (const name in names) {
		state.collapsedGroups[name] = (name !== currentName);
	}

	renderExtractedList(true);

	const page = await state.pdfDoc.getPage(pageNum);
	setRenderScale(4);
	const vp = page.getViewport({ scale: 4 });

	dom.pdfCanvas.width = vp.width;
	dom.pdfCanvas.height = vp.height;
	if (dom.lineCanvas) {
		dom.lineCanvas.width = vp.width;
		dom.lineCanvas.height = vp.height;
	}

	await page.render({
		canvasContext: dom.pdfCanvas.getContext('2d', { willReadFrequently: true }),
		viewport: vp
	}).promise;

	reapplyCropOperations();
	state.scale = (dom.canvasContainer.clientHeight - 4) / (dom.pdfCanvas.height / _renderScale);
	applyZoomTransform(drawUserLines, redrawState);
	clearAllOverlays();
	redrawState();
	drawUserLines();

	if (dom.btnClearLines) dom.btnClearLines.disabled = (state.userLines.length === 0);
	dom.btnPrevWork.disabled = state.currentWorkPage === 0;
	dom.btnNextWork.disabled = state.currentWorkPage >= state.selectedPages.length - 1;
}

function createRegionCanvas(region, { fillWhite = false } = {}) {
	const cr = toCanvasCoords(region);
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(cr.w);
	canvas.height = Math.round(cr.h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (fillWhite) {
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.drawImage(dom.pdfCanvas, cr.x, cr.y, cr.w, cr.h, 0, 0, canvas.width, canvas.height);
	return canvas;
}
async function compositeEditItemsOnCanvas(canvas, regionOverlay) {
	// 現在のページの編集アイテムを取得
	const pageNum = state.selectedPages[state.currentWorkPage];
	const items = state.editItemsByPage[pageNum];
	if (!items || items.length === 0) return;

	const cr = toCanvasCoords(regionOverlay);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });

	for (const item of items) {
		// アイテムが抽出範囲と重なるか判定
		const ix = item.x - cr.x;
		const iy = item.y - cr.y;
		if (ix + item.w <= 0 || iy + item.h <= 0 || ix >= canvas.width || iy >= canvas.height) continue;

		if (item.type === 'image' && item.dataUrl) {
			const img = new Image();
			await new Promise((resolve) => {
				img.onload = resolve;
				img.onerror = resolve;
				img.src = item.dataUrl;
			});
			ctx.drawImage(img, ix, iy, item.w, item.h);
		} else if (item.type === 'text' && item.text) {
			ctx.save();
			ctx.font = '700 ' + (item.fontSize || 24) + 'px "Noto Sans JP", sans-serif';
			ctx.fillStyle = item.color || '#111827';
			ctx.textBaseline = 'middle';
			ctx.fillText(item.text, ix + 8, iy + item.h / 2);
			ctx.restore();
		}
	}
}
async function getSanitizedRegionText(region, position = 'top') {
	const pageNum = state.selectedPages[state.currentWorkPage];
	let txt = await extractEdgeTextFromRegion(pageNum, region, position);
	txt = sanitizeFileBaseName(txt);
	return txt.replace(/\b(\S+)(\s+\1)+\b/g, '$1');
}
function buildCombinedTargetCanvas(targetCanvas) {
	const headerCanvas = state.headerImageData;
	if (state.headerRowImageData) {
		return combineWithHeaderRow(
			headerCanvas,
			state.headerRowImageData,
			targetCanvas,
			state.headerPosition,
			state.fixedHeaderImageData
		);
	}
	return combineImages(headerCanvas, targetCanvas, state.headerPosition);
}
// ===== Selection confirm =====
export function pushExtractedImage(dataUrl, forcedBaseName = '') {
	const ln = getCurrentListName();
	const seq = getNextSeqNum(ln);
	const fallbackName = ln + '_' + String(seq || 1).padStart(3, '0');
	const baseName = (forcedBaseName || state.headerFileBaseName || '').trim();
	const finalName = baseName || fallbackName;

	state.collapsedGroups[ln] = false;

	state.extractedImages.push({
		// ZIP/単体DLは fileBaseName を優先する
		// ヘッダー文字が取れている場合は「連番なし」で固定
		fileBaseName: finalName,
		name: finalName,
		customName: !!baseName,
		listName: ln,
		floorId: state.currentFloorId,
		dataUrl
	});

	renderExtractedList();
	showToast(finalName + ' を抽出しました');
}

export async function confirmHeaderRegion(r) {
	if (state.headerRegion) state.historyRegions.push({ type: 'header', r: state.headerRegion });
	if (state.targetRegion) state.historyRegions.push({ type: 'target', r: state.targetRegion });

	state.headerRegion = r;
	state.targetRegion = null;

	if (state.selectMethod === 'auto') {
		const cells = linesToCells(await detectLines(r));
		if (cells.length > 0) r = cellsBoundingBox(cells);
	}

	state.headerRegion = r;
	clearAllOverlays();
	redrawState();

	const tc = createRegionCanvas(r);

	state.headerImageData = tc;

	dom.btnClearHeader.disabled = false;
	dom.btnSelectTarget.disabled = false;
	dom.btnSelectHeaderRow.disabled = false;
	dom.btnSelectFixedHeader.disabled = false;

	state.mode =
		state.selectionMode === 'withHeader'
			? 'headerRow'
			: state.selectMethod === 'manual'
				? 'manual'
				: 'target';

	updateModeButtons();
}

export async function confirmHeaderRowRegion(r) {
	if (state.headerRowRegion) state.historyRegions.push({ type: 'headerRow', r: state.headerRowRegion });
	if (state.targetRegion) state.historyRegions.push({ type: 'target', r: state.targetRegion });

	state.targetRegion = null;

	if (state.selectMethod === 'auto') {
		const cells = linesToCells(await detectLines(r));
		if (cells.length > 0) r = cellsBoundingBox(cells);
	}

	state.headerRowRegion = r;

	const tc = createRegionCanvas(r);
	state.headerRowImageData = tc;

	clearAllOverlays();
	redrawState();

	(async () => {
		try {
			const txt = await getSanitizedRegionText(r);

			if (!txt) {
				state.headerFileBaseName = '';
				showToast('ヘッダー文字を取得できませんでした');
				return;
			}

			state.headerFileBaseName = txt;
			showToast('ヘッダー文字を取得しました: ' + txt);
		} catch (err) {
			console.warn('headerRow text extraction failed', err);
			state.headerFileBaseName = '';
			showToast('ヘッダー文字の取得に失敗しました');
		}
	})();

	state.mode = state.selectMethod === 'manual' ? 'manual' : 'target';
	updateModeButtons();
}

export async function confirmFixedHeaderRegion(r) {
	if (state.selectMethod === 'auto') {
		const cells = linesToCells(await detectLines(r));
		if (cells.length > 0) r = cellsBoundingBox(cells);
	}

	if (state.fixedHeaderRegion) state.historyRegions.push({ type: 'fixedHeader', r: state.fixedHeaderRegion });
	state.fixedHeaderRegion = r;

	const tc = createRegionCanvas(r);

	state.fixedHeaderImageData = tc;
	clearAllOverlays();
	redrawState();

	state.mode = 'header';
	updateModeButtons();
	showToast('固定ヘッダー確定。見出しを選択してください');
}

export async function confirmTargetRegion(r) {
	if (state.targetRegion) state.historyRegions.push({ type: 'target', r: state.targetRegion });

	if (state.selectMethod === 'auto') {
		const cells = linesToCells(await detectLines(r));
		if (cells.length > 0) r = cellsBoundingBox(cells);
	}

	state.targetRegion = r;

	const tc = createRegionCanvas(r, { fillWhite: true });
	await compositeEditItemsOnCanvas(tc, r);

	clearAllOverlays();
	redrawState();

	const combined = buildCombinedTargetCanvas(tc);

	let targetTopFileBaseName = '';
	if (state.selectionMode === 'headerOnly') {
		try {
			targetTopFileBaseName = await getSanitizedRegionText(r);
		} catch (err) {
			console.warn('target top text extraction failed', err);
		}
	}
	pushExtractedImage(combined.toDataURL('image/jpeg', 0.95), targetTopFileBaseName);

	if (state.selectionMode === 'withHeader') {
		state.mode = 'headerRow';
		updateModeButtons();
	}
}

export async function confirmManualTarget(r) {
	if (state.targetRegion) state.historyRegions.push({ type: 'target', r: state.targetRegion });
	state.targetRegion = r;

	const tc = createRegionCanvas(r, { fillWhite: true });
	await compositeEditItemsOnCanvas(tc, r);

	const combined = buildCombinedTargetCanvas(tc);

	let targetTopFileBaseName = '';
	if (state.selectionMode === 'headerOnly') {
		try {
			targetTopFileBaseName = await getSanitizedRegionText(r);
		} catch (err) {
			console.warn('target top text extraction failed', err);
		}
	}
	pushExtractedImage(combined.toDataURL('image/jpeg', 0.95), targetTopFileBaseName);

	clearAllOverlays();
	redrawState();
}

export async function confirmSingleTarget(r) {
	if (state.targetRegion) state.historyRegions.push({ type: 'target', r: state.targetRegion });

	if (state.selectMethod === 'auto') {
		const cells = linesToCells(await detectLines(r));
		if (cells.length > 0) r = cellsBoundingBox(cells);
	}

	state.targetRegion = r;

	const tc = createRegionCanvas(r, { fillWhite: true });
	await compositeEditItemsOnCanvas(tc, r);

	if (state.addBorder) {
		const ctx = tc.getContext('2d', { willReadFrequently: true });
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 2;
		ctx.strokeRect(1, 1, tc.width - 2, tc.height - 2);
	}

	let singleExtractFileBaseName = '';
	if (state.singleExtractReadText) {
		try {
			singleExtractFileBaseName = await getSanitizedRegionText(r, state.singleExtractTextPosition || 'top');
		} catch (err) {
			console.warn('single target text extraction failed', err);
		}
	}
	pushExtractedImage(tc.toDataURL('image/jpeg', 0.95), singleExtractFileBaseName);

	clearAllOverlays();
	redrawState();
	dom.btnClearHeader.disabled = false;
}

// ===== Undo =====
export function updateUndoButton() {
	if (dom.btnUndo) dom.btnUndo.disabled = state.undoStack.length === 0;
}
export function renderCropPreviewBand() {
	if (!dom.selectionOverlay) return;
	let band = dom.selectionOverlay.querySelector('.crop-preview-band');
	if (!state._cropPreview) {
		if (band) band.remove();
		return;
	}
	const op = state._cropPreview;
	const r = state.scale / _renderScale;
	if (!band) {
		band = document.createElement('div');
		band.className = 'crop-preview-band';
		Object.assign(band.style, { position: 'absolute', pointerEvents: 'none', zIndex: '30', background: 'rgba(239,68,68,0.25)' });
		dom.selectionOverlay.appendChild(band);
	}
	const ow = dom.selectionOverlay.clientWidth, oh = dom.selectionOverlay.clientHeight;
	if (op.direction === 'horizontal') {
		const oy1 = op.y1 * r, oy2 = op.y2 * r;
		Object.assign(band.style, { left: '0', top: oy1 + 'px', width: ow + 'px', height: (oy2 - oy1) + 'px', borderTop: '2px dashed #ef4444', borderBottom: '2px dashed #ef4444', borderLeft: 'none', borderRight: 'none' });
	} else {
		const ox1 = op.x1 * r, ox2 = op.x2 * r;
		Object.assign(band.style, { left: ox1 + 'px', top: '0', width: (ox2 - ox1) + 'px', height: oh + 'px', borderLeft: '2px dashed #ef4444', borderRight: '2px dashed #ef4444', borderTop: 'none', borderBottom: 'none' });
	}
}
export function pushUndoSnapshot() {
	const pageNum = state.selectedPages[state.currentWorkPage];
	if (!pageNum) return;
	state.undoStack.push({
		pageNum,
		editItems: JSON.parse(JSON.stringify(state.editItemsByPage[pageNum] || [])),
		userLines: JSON.parse(JSON.stringify(state.userLinesByPage[pageNum] || [])),
		cropOps: JSON.parse(JSON.stringify(state.cropOperationsByPage[pageNum] || []))
	});
	if (state.undoStack.length > 20) state.undoStack.shift();
	updateUndoButton();
}
export async function performUndo() {
	if (state.undoStack.length === 0) { showToast('元に戻す履歴がありません'); return; }
	const entry = state.undoStack.pop();
	const _cropChanged = (state.cropOperationsByPage[entry.pageNum] || []).length !== (entry.cropOps || []).length;
	state.editItemsByPage[entry.pageNum] = entry.editItems;
	state.userLinesByPage[entry.pageNum] = entry.userLines;
	state.cropOperationsByPage[entry.pageNum] = entry.cropOps;
	if (state.selectedPages[state.currentWorkPage] === entry.pageNum) {
		state.editItems = state.editItemsByPage[entry.pageNum];
		state.userLines = state.userLinesByPage[entry.pageNum];
		state._cropPreview = null;
		dom.selectionOverlay?.querySelector('.crop-preview-band')?.remove();
		if (dom.btnCropExec) dom.btnCropExec.style.display = 'none';
		if (_cropChanged) {
			await renderWorkPage();
		} else {
			drawUserLines();
		}
	}
	updateUndoButton();
	showToast('元に戻しました');
}
// ===== Crop tool =====
export function applyCropToCanvas(op) {
	const canvas = dom.pdfCanvas;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (op.direction === 'horizontal') {
		const y1 = Math.max(0, Math.min(op.y1, canvas.height));
		const y2 = Math.max(0, Math.min(op.y2, canvas.height));
		const cutH = y2 - y1;
		if (cutH <= 0) return;
		const tmp = document.createElement('canvas');
		tmp.width = canvas.width;
		tmp.height = canvas.height - cutH;
		const tc = tmp.getContext('2d', { willReadFrequently: true });
		if (y1 > 0) tc.drawImage(canvas, 0, 0, canvas.width, y1, 0, 0, canvas.width, y1);
		if (y2 < canvas.height) tc.drawImage(canvas, 0, y2, canvas.width, canvas.height - y2, 0, y1, canvas.width, canvas.height - y2);
		canvas.height = tmp.height;
		ctx.drawImage(tmp, 0, 0);
	} else {
		const x1 = Math.max(0, Math.min(op.x1, canvas.width));
		const x2 = Math.max(0, Math.min(op.x2, canvas.width));
		const cutW = x2 - x1;
		if (cutW <= 0) return;
		const tmp = document.createElement('canvas');
		tmp.width = canvas.width - cutW;
		tmp.height = canvas.height;
		const tc = tmp.getContext('2d', { willReadFrequently: true });
		if (x1 > 0) tc.drawImage(canvas, 0, 0, x1, canvas.height, 0, 0, x1, canvas.height);
		if (x2 < canvas.width) tc.drawImage(canvas, x2, 0, canvas.width - x2, canvas.height, x1, 0, canvas.width - x2, canvas.height);
		canvas.width = tmp.width;
		ctx.drawImage(tmp, 0, 0);
	}
}
export function shiftCoordsAfterCrop(op) {
	const pageNum = state.selectedPages[state.currentWorkPage];
	const items = state.editItemsByPage[pageNum] || [];
	const lines = state.userLines || [];
	if (op.direction === 'horizontal') {
		const cut = op.y2 - op.y1;
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it.y + it.h <= op.y1) continue;
			if (it.y >= op.y2) { it.y -= cut; continue; }
			items.splice(i, 1);
		}
		for (let i = lines.length - 1; i >= 0; i--) {
			const L = lines[i];
			if (Math.max(L.y1, L.y2) <= op.y1) continue;
			if (Math.min(L.y1, L.y2) >= op.y2) { L.y1 -= cut; L.y2 -= cut; continue; }
			lines.splice(i, 1);
		}
	} else {
		const cut = op.x2 - op.x1;
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it.x + it.w <= op.x1) continue;
			if (it.x >= op.x2) { it.x -= cut; continue; }
			items.splice(i, 1);
		}
		for (let i = lines.length - 1; i >= 0; i--) {
			const L = lines[i];
			if (Math.max(L.x1, L.x2) <= op.x1) continue;
			if (Math.min(L.x1, L.x2) >= op.x2) { L.x1 -= cut; L.x2 -= cut; continue; }
			lines.splice(i, 1);
		}
	}
}
export function executeCrop(op) {
	pushUndoSnapshot();
	applyCropToCanvas(op);
	shiftCoordsAfterCrop(op);
	const pageNum = state.selectedPages[state.currentWorkPage];
	if (!state.cropOperationsByPage[pageNum]) state.cropOperationsByPage[pageNum] = [];
	state.cropOperationsByPage[pageNum].push(op);
	if (dom.lineCanvas) {
		dom.lineCanvas.width = dom.pdfCanvas.width;
		dom.lineCanvas.height = dom.pdfCanvas.height;
	}
	saveUserLinesForCurrentPage();
	applyZoomTransform(drawUserLines, redrawState);
	state._cropPreview = null;
	dom.selectionOverlay?.querySelector('.crop-preview-band')?.remove();
	if (dom.btnCropExec) dom.btnCropExec.style.display = 'none';
	updateUndoButton();
	showToast('切り取りました');
}
export function reapplyCropOperations() {
	const pageNum = state.selectedPages[state.currentWorkPage];
	const ops = state.cropOperationsByPage[pageNum];
	if (!ops || ops.length === 0) return;
	for (const op of ops) {
		applyCropToCanvas(op);
	}
	if (dom.lineCanvas) {
		dom.lineCanvas.width = dom.pdfCanvas.width;
		dom.lineCanvas.height = dom.pdfCanvas.height;
	}
}
// ===== Line tools =====
export function saveUserLinesForCurrentPage() {
	const pageNum = state.selectedPages[state.currentWorkPage];
	state.userLinesByPage[pageNum] = state.userLines;
	if (dom.btnClearLines) dom.btnClearLines.disabled = (state.userLines.length === 0);
}

export function snapAxisAligned(p1, p2) {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;

	if (Math.abs(dx) >= Math.abs(dy)) {
		const y = (p1.y + p2.y) / 2;
		return { x1: p1.x, y1: y, x2: p2.x, y2: y };
	}
	const x = (p1.x + p2.x) / 2;
	return { x1: x, y1: p1.y, x2: x, y2: p2.y };
}

export function rectToLines(p1, p2) {
	const x1 = Math.min(p1.x, p2.x);
	const x2 = Math.max(p1.x, p2.x);
	const y1 = Math.min(p1.y, p2.y);
	const y2 = Math.max(p1.y, p2.y);

	return [
		{ x1, y1, x2, y2: y1 },
		{ x1: x2, y1, x2, y2 },
		{ x1: x2, y1: y2, x2: x1, y2 },
		{ x1, y1: y2, x2: x1, y2: y1 }
	];
}

function distPointToSegment(px, py, ax, ay, bx, by) {
	const vx = bx - ax;
	const vy = by - ay;
	const wx = px - ax;
	const wy = py - ay;
	const c1 = vx * wx + vy * wy;
	if (c1 <= 0) return Math.hypot(px - ax, py - ay);
	const c2 = vx * vx + vy * vy;
	if (c2 <= c1) return Math.hypot(px - bx, py - by);
	const t = c1 / c2;
	const hx = ax + t * vx;
	const hy = ay + t * vy;
	return Math.hypot(px - hx, py - hy);
}

export function hitTestUserLine(canvasPt) {
	const tol = 6 * (_renderScale / state.scale);
	let best = -1;
	let bestD = Infinity;

	for (let i = 0; i < state.userLines.length; i++) {
		const L = state.userLines[i];
		const d = distPointToSegment(canvasPt.x, canvasPt.y, L.x1, L.y1, L.x2, L.y2);
		if (d <= tol && d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

export function hitTestUserLineEndpoint(canvasPt) {
	const tol = 8 * (_renderScale / state.scale);
	let best = { index: -1, endpoint: null, d: Infinity };

	for (let i = 0; i < state.userLines.length; i++) {
		const L = state.userLines[i];
		const d1 = Math.hypot(canvasPt.x - L.x1, canvasPt.y - L.y1);
		const d2 = Math.hypot(canvasPt.x - L.x2, canvasPt.y - L.y2);

		if (d1 <= tol && d1 < best.d) best = { index: i, endpoint: 'a', d: d1 };
		if (d2 <= tol && d2 < best.d) best = { index: i, endpoint: 'b', d: d2 };
	}
	return best.index >= 0 ? best : null;
}

function lineCenter(L) {
	return { x: (L.x1 + L.x2) / 2, y: (L.y1 + L.y2) / 2 };
}

function lineIntersectsRectCanvas(L, rc) {
	const minX = Math.min(L.x1, L.x2);
	const maxX = Math.max(L.x1, L.x2);
	const minY = Math.min(L.y1, L.y2);
	const maxY = Math.max(L.y1, L.y2);

	if (maxX < rc.x || minX > rc.x + rc.w || maxY < rc.y || minY > rc.y + rc.h) return false;

	if (Math.abs(L.y2 - L.y1) < Math.abs(L.x2 - L.x1)) {
		const y = (L.y1 + L.y2) / 2;
		if (y < rc.y || y > rc.y + rc.h) return false;
		return !(maxX < rc.x || minX > rc.x + rc.w);
	}

	const x = (L.x1 + L.x2) / 2;
	if (x < rc.x || x > rc.x + rc.w) return false;
	return !(maxY < rc.y || minY > rc.y + rc.h);
}

export function hitTestUserLinesInOverlayRect(rOverlay) {
	const k = _renderScale / state.scale;
	const rc = {
		x: rOverlay.x * k,
		y: rOverlay.y * k,
		w: rOverlay.w * k,
		h: rOverlay.h * k
	};

	const hits = [];
	for (let i = 0; i < state.userLines.length; i++) {
		if (lineIntersectsRectCanvas(state.userLines[i], rc)) hits.push(i);
	}

	if (hits.length > 1) {
		const cx = rc.x + rc.w / 2;
		const cy = rc.y + rc.h / 2;
		hits.sort((a, b) => {
			const ac = lineCenter(state.userLines[a]);
			const bc = lineCenter(state.userLines[b]);
			return Math.hypot(ac.x - cx, ac.y - cy) - Math.hypot(bc.x - cx, bc.y - cy);
		});
	}
	return hits;
}

export function drawUserLines(opts) {
	if (!dom.lineCanvas) return;

	const ctx = dom.lineCanvas.getContext('2d');
	ctx.clearRect(0, 0, dom.lineCanvas.width, dom.lineCanvas.height);
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'miter';
	ctx.lineWidth = state.userLineStyle.width || 2;

	for (let i = 0; i < state.userLines.length; i++) {
		const L = state.userLines[i];
		const isSel =
			(i === state.selectedUserLineIndex) ||
			(state.selectedUserLineIndices && state.selectedUserLineIndices.indexOf(i) >= 0);

		ctx.strokeStyle = isSel
			? 'rgba(59, 130, 246, 0.95)'
			: (state.userLineStyle.color || 'rgba(0,0,0,0.95)');
		ctx.setLineDash([]);
		ctx.beginPath();
		ctx.moveTo(L.x1, L.y1);
		ctx.lineTo(L.x2, L.y2);
		ctx.stroke();

		if (isSel) {
			ctx.fillStyle = 'rgba(59, 130, 246, 0.95)';
			ctx.beginPath(); ctx.arc(L.x1, L.y1, 3, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(L.x2, L.y2, 3, 0, Math.PI * 2); ctx.fill();
		}
	}

	if (opts && opts.preview) {
		const p = opts.preview;
		ctx.strokeStyle = state.userLineStyle.color || 'rgba(0,0,0,0.55)';
		ctx.globalAlpha = 0.55;
		ctx.setLineDash([6, 6]);

		if (Array.isArray(p)) {
			for (let k = 0; k < p.length; k++) {
				ctx.beginPath();
				ctx.moveTo(p[k].x1, p[k].y1);
				ctx.lineTo(p[k].x2, p[k].y2);
				ctx.stroke();
			}
		} else {
			ctx.beginPath();
			ctx.moveTo(p.x1, p.y1);
			ctx.lineTo(p.x2, p.y2);
			ctx.stroke();
		}
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}
}

// ===== Extracted list =====
function openPreviewModal(startIndex) {
	if (!state.extractedImages || !state.extractedImages.length) return;
	let currentIndex = startIndex;
	const oldModal = document.querySelector('.preview-modal');
	if (oldModal) oldModal.remove();
	const modal = document.createElement('div');
	modal.className = 'preview-modal';
	const closeBtn = document.createElement('button');
	closeBtn.className = 'preview-close-btn';
	closeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
	const img = document.createElement('img');
	img.style.maxWidth = '90vw';
	img.style.maxHeight = '78vh';
	const nameWrap = document.createElement('div');
	nameWrap.className = 'preview-modal-name';
	nameWrap.style.marginTop = '16px';
	nameWrap.innerHTML = '<input type="text" class="preview-name-input"> <span>.jpg</span>';
	const nameInput = nameWrap.querySelector('.preview-name-input');
	const nav = document.createElement('div');
	nav.style.display = 'flex';
	nav.style.alignItems = 'center';
	nav.style.justifyContent = 'center';
	nav.style.gap = '12px';
	nav.style.marginTop = '16px';
	nav.innerHTML =
		'<button class="btn btn-icon preview-nav-btn" data-dir="prev"><span class="material-symbols-rounded">chevron_left</span></button>' +
		'<div class="badge-info"><span class="material-symbols-rounded">imagesmode</span><span class="preview-index-label"></span></div>' +
		'<button class="btn btn-icon preview-nav-btn" data-dir="next"><span class="material-symbols-rounded">chevron_right</span></button>';
	const prevBtn = nav.querySelector('[data-dir="prev"]');
	const nextBtn = nav.querySelector('[data-dir="next"]');
	const indexLabel = nav.querySelector('.preview-index-label');
	function renderPreview() {
		const item = state.extractedImages[currentIndex];
		if (!item) return;
		img.src = item.dataUrl;
		nameInput.value = item.name || '';
		indexLabel.textContent = `${currentIndex + 1} / ${state.extractedImages.length}`;
		prevBtn.disabled = currentIndex <= 0;
		nextBtn.disabled = currentIndex >= state.extractedImages.length - 1;
	}
	function closeModal() {
		document.removeEventListener('keydown', onKeydown);
		modal.remove();
	}
	function onKeydown(e) {
		if (e.key === 'Escape') {
			closeModal();
			return;
		}
		if (e.key === 'ArrowLeft' && currentIndex > 0) {
			currentIndex--;
			renderPreview();
		}
		if (e.key === 'ArrowRight' && currentIndex < state.extractedImages.length - 1) {
			currentIndex++;
			renderPreview();
		}
	}
	closeBtn.addEventListener('click', closeModal);
	modal.addEventListener('click', (e) => {
		if (e.target === modal) closeModal();
	});
	document.addEventListener('keydown', onKeydown);
	prevBtn.addEventListener('click', () => {
		if (currentIndex <= 0) return;
		currentIndex--;
		renderPreview();
	});
	nextBtn.addEventListener('click', () => {
		if (currentIndex >= state.extractedImages.length - 1) return;
		currentIndex++;
		renderPreview();
	});
	nameInput.addEventListener('change', (e) => {
		const item = state.extractedImages[currentIndex];
		if (!item) return;
		const newName = e.target.value.trim();
		if (!newName) {
			e.target.value = item.name || '';
			return;
		}
		item.name = newName;
		item.customName = true;
		renderExtractedList(true);
		renderPreview();
	});
	modal.appendChild(closeBtn);
	modal.appendChild(img);
	modal.appendChild(nameWrap);
	modal.appendChild(nav);
	document.body.appendChild(modal);
	renderPreview();
	nameInput.addEventListener('focus', (e) => {
		e.target.select();
	});
}
export function renderExtractedList(preventScroll) {
	dom.extractedList.innerHTML = '';
	dom.extractCount.textContent = '(' + state.extractedImages.length + ')';
	dom.btnDownloadAll.disabled = state.extractedImages.length === 0;
	dom.btnClearImages.disabled = state.extractedImages.length === 0;

	const grouped = {};
	state.extractedImages.forEach((img, i) => {
		if (!grouped[img.listName]) grouped[img.listName] = {};
		const fid = img.floorId || 'default';
		if (!grouped[img.listName][fid]) grouped[img.listName][fid] = [];
		grouped[img.listName][fid].push({ img, index: i });
	});
	const getFloorName = (fid) => {
		const f = state.floors.find((fl) => fl.id === fid);
		return f ? f.name : '未分類';
	};

	for (const listName in grouped) {
		const groupContainer = document.createElement('div');
		const isCollapsed = state.collapsedGroups[listName];

		const header = document.createElement('div');
		header.className = 'group-header';
		const listTotal = Object.values(grouped[listName]).reduce((s, a) => s + a.length, 0);
		header.innerHTML =
			`<span>${listName} <span style="color:var(--text-muted);font-weight:normal;font-size:0.75rem;">(${listTotal})</span></span>` +
			`<span class="material-symbols-rounded group-toggle-icon ${isCollapsed ? 'collapsed' : ''}">expand_more</span>`;

		header.addEventListener('click', () => {
			state.collapsedGroups[listName] = !state.collapsedGroups[listName];
			renderExtractedList(true);
		});
		header.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; header.classList.add('drag-over'); });
		header.addEventListener('dragleave', () => { header.classList.remove('drag-over'); });
		header.addEventListener('drop', (e) => {
			e.preventDefault();
			header.classList.remove('drag-over');
			const idx = parseInt(e.dataTransfer.getData('text/plain'), 10);
			if (isNaN(idx) || !state.extractedImages[idx]) return;
			const im = state.extractedImages[idx];
			if (im.listName === listName) return;
			im.listName = listName;
			renderExtractedList(true);
			showToast(listName + ' に移動しました');
		});

		const listContent = document.createElement('div');
		listContent.className = 'group-content' + (isCollapsed ? ' collapsed' : '');
		const floorIds = Object.keys(grouped[listName]);
		for (const fid of floorIds) {
			const floorName = getFloorName(fid);
			const floorKey = listName + ':' + fid;
			const floorCollapsed = state.collapsedFloors[floorKey];
			const floorHeader = document.createElement('div');
			floorHeader.className = 'floor-subgroup-header';
			floorHeader.innerHTML =
				`<span>${floorName} <span style="color:var(--text-muted);font-weight:normal;font-size:0.7rem;">(${grouped[listName][fid].length})</span></span>` +
				`<span class="material-symbols-rounded group-toggle-icon ${floorCollapsed ? 'collapsed' : ''}" style="font-size:1rem;">expand_more</span>`;
			floorHeader.addEventListener('click', (e) => {
				e.stopPropagation();
				state.collapsedFloors[floorKey] = !state.collapsedFloors[floorKey];
				renderExtractedList(true);
			});
			floorHeader.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; floorHeader.classList.add('drag-over'); });
			floorHeader.addEventListener('dragleave', () => { floorHeader.classList.remove('drag-over'); });
			floorHeader.addEventListener('drop', (e) => {
				e.preventDefault();
				floorHeader.classList.remove('drag-over');
				const idx = parseInt(e.dataTransfer.getData('text/plain'), 10);
				if (isNaN(idx) || !state.extractedImages[idx]) return;
				const im = state.extractedImages[idx];
				if (im.floorId === fid && im.listName === listName) return;
				im.floorId = fid;
				im.listName = listName;
				renderExtractedList(true);
				showToast(getFloorName(fid) + ' に移動しました');
			});
			listContent.appendChild(floorHeader);
			const contentGrid = document.createElement('div');
			contentGrid.className = 'group-content' + (floorCollapsed ? ' collapsed' : '');

		grouped[listName][fid].forEach((item) => {
			const { img, index } = item;
			const el = document.createElement('div');
			el.className = 'extracted-item';
			el.draggable = true;
			el.dataset.imgIndex = index;
			el.addEventListener('dragstart', (e) => {
				e.dataTransfer.setData('text/plain', String(index));
				e.dataTransfer.effectAllowed = 'move';
				el.classList.add('dragging');
			});
			el.addEventListener('dragend', () => { el.classList.remove('dragging'); });

			el.innerHTML =
				`<img src="${img.dataUrl}">` +
				`<div style="display:flex; align-items:center; border-top: 1px solid var(--border); background: var(--surface-alt);">` +
				`<input type="text" class="extracted-item-name-input" value="${img.name}" title="ファイル名を変更">` +
				`<span class="extracted-item-ext">.jpg</span>` +
				`</div>` +
				`<button class="del-btn" title="削除"><span class="material-symbols-rounded">close</span></button>`;

			const previewImg = el.querySelector('img');
			previewImg.addEventListener('click', () => {
				openPreviewModal(index);
			});
			const nameInput = el.querySelector('.extracted-item-name-input');
			nameInput.addEventListener('focus', (e) => {
				e.target.select();
				e.target.addEventListener('mouseup', function prevent(e2) {
					e2.preventDefault();
					e.target.removeEventListener('mouseup', prevent);
				});
			});

			nameInput.addEventListener('change', (e) => {
				const newName = e.target.value.trim();
				if (newName && newName !== img.name) {
					state.extractedImages[index].name = newName;
					state.extractedImages[index].customName = true;
				} else {
					e.target.value = img.name;
				}
			});

			el.querySelector('.del-btn').addEventListener('click', () => {
				state.extractedImages.splice(index, 1);
				renumberImages();
				renderExtractedList(true);
			});

			contentGrid.appendChild(el);
		});

			listContent.appendChild(contentGrid);
		}
		groupContainer.appendChild(header);
		groupContainer.appendChild(listContent);
		dom.extractedList.appendChild(groupContainer);
	}

	if (!preventScroll) {
		setTimeout(() => {
			if (dom.extractedList) dom.extractedList.scrollTop = dom.extractedList.scrollHeight;
		}, 10);
	}
}

export function getDownloadFileName(img, index) {
	let base = (img && img.fileBaseName) ? String(img.fileBaseName).trim() : '';
	if (!base) base = (img && img.name) ? String(img.name).trim() : '';
	if (!base) base = 'image' + String(index + 1).padStart(3, '0');

	base = base.replace(/[\\\/:\?"<>\|]/g, '').replace(/[\s.]+$/g, '').trim();
	if (!base) base = 'image' + String(index + 1).padStart(3, '0');
	return base;
}
// 罫線端点のカーソル判定
export function getLineEndpointCursorType(canvasPt) {
  const hit = hitTestUserLineEndpoint(canvasPt);
  if (!hit) return null;
  const L = state.userLines[hit.index];
  const isHorizontal = Math.abs(L.x2 - L.x1) >= Math.abs(L.y2 - L.y1);
  return isHorizontal ? 'ew-resize' : 'ns-resize';
}