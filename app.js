// app.js
import {
	state,
	dom,
	qs,
	showToast,
	showStep,
	setupToggleGroup,
	getCurrentListName,
	resetPageSelection,
	resetWorkState,
	overlayToCanvasPoint,
	applyZoomTransform
} from './core.js';

import {
	handleFile,
	renderWorkPage,
	renderExtractedList,
	updatePageControls,
	updateThumbnailStyles,
	updateModeButtons,
	redrawState,
	getOverlayCoords,
	calcRect,
	drawRect,
	confirmHeaderRegion,
	confirmHeaderRowRegion,
	confirmFixedHeaderRegion,
	confirmTargetRegion,
	confirmManualTarget,
	confirmSingleTarget,
	drawUserLines,
	saveUserLinesForCurrentPage,
	snapAxisAligned,
	rectToLines,
	hitTestUserLine,
	hitTestUserLineEndpoint,
	hitTestUserLinesInOverlayRect,
	getDownloadFileName
} from './pdf-workflow.js';

// ===== Settings popover =====
if (dom.btnSettingsToggle) {
	dom.btnSettingsToggle.addEventListener('click', (e) => {
		e.stopPropagation();
		dom.settingsPopover.classList.toggle('hidden');
	});
}

document.addEventListener('click', (e) => {
	if (!dom.settingsPopover || !dom.btnSettingsToggle) return;
	if (!dom.settingsPopover.contains(e.target) && e.target !== dom.btnSettingsToggle) {
		dom.settingsPopover.classList.add('hidden');
	}
});

// ===== Toggle groups =====
setupToggleGroup('headerPositionGroup', 'headerPosition');

setupToggleGroup('selectionModeGroup', 'selectionMode', (val) => {
	state.headerRegion = null;
	state.headerCells = [];
	state.targetRegion = null;
	state.targetCells = [];
	state.headerRect = null;
	state.headerImageData = null;
	state.headerRowRegion = null;
	state.headerRowCells = [];
	state.headerRowImageData = null;
	state.fixedHeaderRegion = null;
	state.fixedHeaderImageData = null;

	if (val !== 'grid') {
		state.mode =
			state.selectionMode === 'withHeader'
				? 'fixedHeader'
				: state.selectionMode === 'single'
					? 'single'
					: 'header';
	} else {
		setDrawTool('line');
	}

	state.selectMethod = (val === 'single') ? 'manual' : 'auto';

	qs('#selectMethodGroup').querySelectorAll('button').forEach((b) => {
		b.classList.toggle('active', b.dataset.value === state.selectMethod);
	});

	dom.btnClearHeader.disabled = true;
	applySelectionMode();
	updateModeButtons();

	const msgs = {
		grid: '罫線モード',
		headerOnly: '見出しを選択してください',
		withHeader: '固定ヘッダーを選択してください',
		single: '抽出する範囲を選択してください'
	};
	showToast(msgs[state.selectionMode]);
});

setupToggleGroup('selectMethodGroup', 'selectMethod', () => {
	if (state.mode === 'target' && state.selectMethod === 'manual') state.mode = 'manual';
	else if (state.mode === 'manual' && state.selectMethod === 'auto') state.mode = 'target';
	updateModeButtons();
});

// ===== Line tool visibility =====
function updateLineToolsVisibility() {
	const isGrid = state.selectionMode === 'grid';
	const tg = qs('#drawToolGroup');
	if (tg) tg.style.display = isGrid ? 'inline-flex' : 'none';

	const styleGroup = qs('#lineStyleGroup');
	if (styleGroup) styleGroup.style.display = isGrid ? 'inline-flex' : 'none';
	if (dom.btnClearLines) dom.btnClearLines.style.display = isGrid ? 'inline-flex' : 'none';

	if (!isGrid) {
		state.selectedUserLineIndex = -1;
		state._toolDrag = null;
	}
	if (dom.btnClearLines) dom.btnClearLines.disabled = (state.userLines.length === 0);
	drawUserLines();
}

function applySelectionMode() {
	const m = state.selectionMode;
	const isSingle = m === 'single';
	const isGrid = m === 'grid';

	dom.btnSelectFixedHeader.style.display = (!isGrid && m === 'withHeader') ? 'inline-flex' : 'none';
	dom.btnSelectHeader.style.display = (!isGrid && !isSingle) ? 'inline-flex' : 'none';
	dom.btnSelectHeaderRow.style.display = (!isGrid && m === 'withHeader') ? 'inline-flex' : 'none';
	dom.btnSelectTarget.style.display = isGrid ? 'none' : 'inline-flex';
	dom.btnClearHeader.style.display = isGrid ? 'none' : 'inline-flex';

	const positionBtns = dom.positionSettingItem.querySelectorAll('button');
	positionBtns.forEach((btn) => { btn.disabled = isSingle || isGrid; });

	dom.positionSettingItem.style.opacity = (isSingle || isGrid) ? '0.5' : '1';
	dom.positionSettingItem.querySelector('label').style.opacity = (isSingle || isGrid) ? '0.5' : '1';

	dom.btnSelectTarget.disabled = !isSingle;
	dom.btnSelectHeaderRow.disabled = true;

	updateLineToolsVisibility();
}

// ===== Sliders =====
dom.gridThreshold?.addEventListener('input', () => {
	dom.thresholdValue.textContent = dom.gridThreshold.value;
});
dom.minLineLen?.addEventListener('input', () => {
	dom.minLineLenValue.textContent = dom.minLineLen.value;
});
dom.gridThreshold?.addEventListener('dblclick', () => {
	dom.gridThreshold.value = 170;
	dom.thresholdValue.textContent = 170;
});
dom.minLineLen?.addEventListener('dblclick', () => {
	dom.minLineLen.value = 20;
	dom.minLineLenValue.textContent = 20;
});

// ===== listName =====
if (dom.listNameInput) {
	dom.listNameInput.addEventListener('focus', (e) => {
		e.target.select();
		e.target.addEventListener('mouseup', function prevent(e2) {
			e2.preventDefault();
			e.target.removeEventListener('mouseup', prevent);
		});
	});

	dom.listNameInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') e.target.blur();
	});

	dom.listNameInput.addEventListener('change', (e) => {
		const oldName = getCurrentListName();
		const newName = e.target.value.trim() || '名称未設定';

		if (oldName !== newName) {
			const pageNum = state.selectedPages[state.currentWorkPage];

			for (let i = 0; i < state.pages.length; i++) {
				if (state.pages[i].pageNum === pageNum) {
					state.pages[i].drawingName = newName;
					break;
				}
			}

			state.extractedImages.forEach((img) => {
				if (img.listName === oldName) img.listName = newName;
			});

			if (state.collapsedGroups[oldName] !== undefined) {
				state.collapsedGroups[newName] = state.collapsedGroups[oldName];
				delete state.collapsedGroups[oldName];
			}

			renderExtractedList(true);
			showToast('リスト名を変更しました');
		} else {
			e.target.value = oldName;
		}
	});
}

// ===== Border checkbox =====
if (dom.addBorderCheckbox) {
	const borderLabel = qs('#borderCheckboxLabel');
	const borderText = qs('#borderCheckboxText');

	dom.addBorderCheckbox.addEventListener('change', (e) => {
		state.addBorder = e.target.checked;
		if (e.target.checked) {
			if (borderLabel) borderLabel.classList.add('active');
			if (borderText) borderText.textContent = 'あり';
		} else {
			if (borderLabel) borderLabel.classList.remove('active');
			if (borderText) borderText.textContent = 'なし';
		}
	});
}

// ===== File input =====
dom.pdfInput?.addEventListener('change', (e) => {
	handleFile(e.target.files[0]);
});
dom.dropZone?.addEventListener('dragover', (e) => {
	e.preventDefault();
	dom.dropZone.classList.add('dragover');
});
dom.dropZone?.addEventListener('dragleave', () => {
	dom.dropZone.classList.remove('dragover');
});
dom.dropZone?.addEventListener('drop', (e) => {
	e.preventDefault();
	dom.dropZone.classList.remove('dragover');
	handleFile(e.dataTransfer.files[0]);
});

// ===== step2 buttons =====
dom.btnSelectAll?.addEventListener('click', () => {
	state.pages.forEach((p) => { p.selected = true; });
	updateThumbnailStyles();
	updatePageControls();
});
dom.btnDeselectAll?.addEventListener('click', () => {
	state.pages.forEach((p) => { p.selected = false; });
	updateThumbnailStyles();
	updatePageControls();
});
dom.goToStep3?.addEventListener('click', () => {
	state.selectedPages = state.pages.filter((p) => p.selected).map((p) => p.pageNum);
	state.currentWorkPage = 0;
	resetWorkState();
	renderWorkPage();
	showStep(3);
});

// ===== mode buttons =====
dom.btnSelectHeader?.addEventListener('click', () => {
	state.mode = 'header';
	updateModeButtons();
});
dom.btnSelectTarget?.addEventListener('click', () => {
	if (!state.headerRegion && !state.headerRect && state.selectionMode !== 'single') {
		showToast('先に見出しを選択してください');
		return;
	}
	state.mode = state.selectMethod === 'manual' ? 'manual' : 'target';
	updateModeButtons();
});
dom.btnSelectHeaderRow?.addEventListener('click', () => {
	if (!state.headerRegion && !state.headerRect) {
		showToast('先に見出しを選択してください');
		return;
	}
	state.mode = 'headerRow';
	updateModeButtons();
});
dom.btnSelectFixedHeader?.addEventListener('click', () => {
	state.mode = 'fixedHeader';
	updateModeButtons();
});
dom.btnClearHeader?.addEventListener('click', () => {
	resetPageSelection();
	updateModeButtons();
});

// ===== page move =====
dom.btnPrevWork?.addEventListener('click', () => {
	if (state.currentWorkPage > 0) {
		state.currentWorkPage--;
		dom.canvasContainer.scrollLeft = 0;
		dom.canvasContainer.scrollTop = 0;
		resetPageSelection();
		renderWorkPage();
	}
});
dom.btnNextWork?.addEventListener('click', () => {
	if (state.currentWorkPage < state.selectedPages.length - 1) {
		state.currentWorkPage++;
		dom.canvasContainer.scrollLeft = 0;
		dom.canvasContainer.scrollTop = 0;
		resetPageSelection();
		renderWorkPage();
	}
});

// ===== draw tools =====
function setDrawTool(tool) {
	state.drawTool = tool;

	[dom.btnToolSelect, dom.btnToolLine, dom.btnToolRect]
		.filter(Boolean)
		.forEach((b) => {
			b.classList.toggle('active', b.dataset.tool === tool);
		});

	if (tool !== 'select') {
		state.selectedUserLineIndex = -1;
		state.selectedUserLineIndices = [];
	}

	dom.selectionOverlay.style.cursor = (tool === 'select') ? 'default' : 'crosshair';
	drawUserLines();
}

dom.btnToolSelect?.addEventListener('click', () => setDrawTool('select'));
dom.btnToolLine?.addEventListener('click', () => setDrawTool('line'));
dom.btnToolRect?.addEventListener('click', () => setDrawTool('rect'));

function applyUserLineStyleFromUI() {
	if (dom.lineColor) state.userLineStyle.color = dom.lineColor.value || '#ef4444';
	if (dom.lineWidth) state.userLineStyle.width = parseInt(dom.lineWidth.value, 10) || 4;
	if (dom.lineWidthValue) dom.lineWidthValue.textContent = String(state.userLineStyle.width);
	drawUserLines();
}
dom.lineColor?.addEventListener('input', applyUserLineStyleFromUI);
dom.lineWidth?.addEventListener('input', applyUserLineStyleFromUI);
applyUserLineStyleFromUI();

// ===== overlay selection =====
dom.selectionOverlay?.addEventListener('mousedown', (e) => {
	if (e.button !== 0) return;

	if (state.selectionMode === 'grid') {
		const canvasPt = overlayToCanvasPoint(getOverlayCoords(e));

		if (state.drawTool === 'line' || state.drawTool === 'rect') {
			state._toolDrag = {
				kind: state.drawTool,
				startCanvas: canvasPt,
				lastCanvas: canvasPt
			};
			e.preventDefault();
			return;
		}

		if (state.drawTool === 'select') {
			const ep = hitTestUserLineEndpoint(canvasPt);
			if (ep) {
				state.selectedUserLineIndex = ep.index;
				state._toolDrag = {
					kind: 'resizeLine',
					startCanvas: canvasPt,
					lastCanvas: canvasPt,
					index: ep.index,
					endpoint: ep.endpoint
				};
				drawUserLines();
				e.preventDefault();
				return;
			}

			const hit = hitTestUserLine(canvasPt);
			state.selectedUserLineIndex = hit;

			if (hit >= 0) {
				if (!state.selectedUserLineIndices || state.selectedUserLineIndices.indexOf(hit) < 0) {
					state.selectedUserLineIndices = [hit];
				}
				state._toolDrag = {
					kind: 'moveLine',
					startCanvas: canvasPt,
					lastCanvas: canvasPt,
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

dom.selectionOverlay?.addEventListener('mousemove', (e) => {
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
	drawRect(
		r,
		state.mode === 'fixedHeader'
			? 'fixed-header-sel'
			: state.mode === 'headerRow'
				? 'header-row-sel'
				: state.mode === 'header'
					? 'header-sel'
					: 'target-sel'
	);
});

dom.selectionOverlay?.addEventListener('mouseup', (e) => {
	if (state.selectionMode === 'grid' && state._toolDrag) {
		const start = state._toolDrag.startCanvas;
		const end = state._toolDrag.lastCanvas || start;

		if (state._toolDrag.kind === 'line') {
			const L = snapAxisAligned(start, end);
			if (Math.hypot(L.x2 - L.x1, L.y2 - L.y1) >= 5) {
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

// ===== clear lines =====
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

// ===== keyboard =====
window.addEventListener('keydown', (e) => {
	if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

	if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
		if (state.drawTool === 'select' && state.selectedUserLineIndex >= 0) {
			const L = state.userLines[state.selectedUserLineIndex];
			if (L) {
				state._copiedUserLine = { ...L };
				showToast('罫線をコピーしました');
				e.preventDefault();
			}
		}
		return;
	}

	if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
		if (state.drawTool === 'select' && state._copiedUserLine) {
			const copy = {
				x1: state._copiedUserLine.x1 + 20,
				y1: state._copiedUserLine.y1 + 20,
				x2: state._copiedUserLine.x2 + 20,
				y2: state._copiedUserLine.y2 + 20
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

// ===== zoom =====
function getMinScale() {
	return (!state.pdfDoc || !dom.pdfCanvas.height)
		? 0.5
		: Math.max((dom.canvasContainer.clientHeight - 4) / (dom.pdfCanvas.height / 4), 0.3);
}

function rescaleRegions(ratio) {
	const sr = (r) => r ? ({ x: r.x * ratio, y: r.y * ratio, w: r.w * ratio, h: r.h * ratio }) : null;
	const sc = (cells) => cells.map((c) => ({
		x: c.x * ratio,
		y: c.y * ratio,
		w: c.w * ratio,
		h: c.h * ratio,
		row: c.row,
		col: c.col
	}));

	state.headerRegion = sr(state.headerRegion);
	state.targetRegion = sr(state.targetRegion);
	state.headerRect = sr(state.headerRect);
	state.fixedHeaderRegion = sr(state.fixedHeaderRegion);
	state.headerRowRegion = sr(state.headerRowRegion);
	state.headerCells = sc(state.headerCells);
	state.targetCells = sc(state.targetCells);
	state.headerRowCells = sc(state.headerRowCells);
	state.historyRegions = state.historyRegions.map((hr) => ({ type: hr.type, r: sr(hr.r) }));
}

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
}, { passive: false });

// ===== pan =====
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

// ===== clear images =====
dom.btnClearImages?.addEventListener('click', () => {
	state.extractedImages = [];
	state.collapsedGroups = {};
	renderExtractedList();
	showToast('画像をすべてクリアしました');
});

// ===== reset =====
dom.btnResetAlls.forEach((btn) => {
	btn.addEventListener('click', () => {
		state.pdfDoc = null;
		state.pages = [];
		state.selectedPages = [];
		state.currentWorkPage = 0;
		state.scale = 4;
		resetPageSelection();
		state.extractedImages = [];
		state.collapsedGroups = {};
		renderExtractedList();

		state.selectionMode = 'headerOnly';
		state.selectMethod = 'auto';
		state.headerPosition = 'left';
		state.addBorder = true;

		qs('#selectionModeGroup').querySelectorAll('button').forEach((b) => {
			b.classList.toggle('active', b.dataset.value === 'headerOnly');
		});
		qs('#selectMethodGroup').querySelectorAll('button').forEach((b) => {
			b.classList.toggle('active', b.dataset.value === 'auto');
		});
		qs('#headerPositionGroup').querySelectorAll('button').forEach((b) => {
			b.classList.toggle('active', b.dataset.value === 'left');
		});

		if (dom.addBorderCheckbox) {
			dom.addBorderCheckbox.checked = true;
			const lbl = qs('#borderCheckboxLabel');
			const txt = qs('#borderCheckboxText');
			if (lbl) lbl.classList.add('active');
			if (txt) txt.textContent = 'あり';
		}

		dom.pdfInput.value = '';
		dom.pageThumbnails.innerHTML = '';
		dom.btnDownloadAll.disabled = true;

		applySelectionMode();
		showStep(1);
		showToast('リセットしました');
	});
});

// ===== download =====
dom.btnDownloadAll.onclick = function() {
	if (state.extractedImages.length === 0) return;

	if (state.extractedImages.length === 1) {
		const a = document.createElement('a');
		a.href = state.extractedImages[0].dataUrl;
		a.download = getDownloadFileName(state.extractedImages[0], 0) + '.jpg';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		return;
	}

	showToast('ZIPファイルを作成中...');

	const zip = new JSZip();
	for (let i = 0; i < state.extractedImages.length; i++) {
		const img = state.extractedImages[i];
		const fn = getDownloadFileName(img, i);
		zip.folder(img.listName).file(fn + '.jpg', img.dataUrl.split(',')[1], { base64: true });
	}

	zip.generateAsync({ type: 'base64' })
		.then((b64) => {
			const a = document.createElement('a');
			a.href = 'data:application/zip;base64,' + b64;
			a.download = '抽出画像.zip';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => document.body.removeChild(a), 500);
			showToast('ダウンロード完了');
		})
		.catch((err) => {
			showToast('ZIP作成失敗: ' + err.message);
		});
};

// ===== init =====
applySelectionMode();
updateModeButtons();
showStep(1);