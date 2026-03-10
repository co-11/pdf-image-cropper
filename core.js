// core.js

// ===== Theme Management =====
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
let isDark = true;

function applyTheme() {
	document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
	if (themeIcon) themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

if (themeToggle) {
	themeToggle.addEventListener('click', () => {
		isDark = !isDark;
		applyTheme();
	});
}
applyTheme();

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
	'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ===== State =====
export const state = {
	pdfDoc: null,
	pages: [],
	selectedPages: [],
	currentWorkPage: 0,
	scale: 4,

	mode: 'header',
	headerPosition: 'left',
	addBorder: true,

	headerRegion: null,
	headerCells: [],
	targetRegion: null,
	targetCells: [],

	headerImageData: null,
	headerRect: null,

	headerRowRegion: null,
	headerRowCells: [],
	headerRowImageData: null,

	fixedHeaderRegion: null,
	fixedHeaderImageData: null,

	selectionMode: 'headerOnly',
	selectMethod: 'auto',

	extractedImages: [],
	historyRegions: [],

	headerFileBaseName: '',

	userLinesByPage: {},
	userLines: [],
	isDrawingLine: false,
	_lineStartCanvas: null,

	isDragging: false,
	dragStart: null,
	dragCurrent: null,
	lastClickedIndex: -1,

	collapsedGroups: {},

	userLineStyle: { color: '#ef4444', width: 4 },

	drawTool: 'select',
	selectedUserLineIndex: -1,
	selectedUserLineIndices: [],
	_toolDrag: null,
	_copiedUserLine: null
};

export let _renderScale = 4;
export function setRenderScale(v) {
	_renderScale = v;
}

// ===== DOM =====
export function qs(sel) {
	return document.querySelector(sel);
}

export const dom = {
	pdfInput: qs('#pdfInput'),
	dropZone: qs('#dropZone'),
	loadingInfo: qs('#loadingInfo'),

	step1: qs('#step1'),
	step2: qs('#step2'),
	step3: qs('#step3'),
	st1: qs('#st1'),
	st2: qs('#st2'),
	st3: qs('#st3'),

	pageThumbnails: qs('#pageThumbnails'),
	pageIndicator: qs('#pageIndicator'),

	goToStep3: qs('#goToStep3'),
	btnSelectAll: qs('#btnSelectAll'),
	btnDeselectAll: qs('#btnDeselectAll'),

	listNameInput: qs('#listNameInput'),
	currentPageLabel: qs('#currentPageLabel'),

	btnSelectHeader: qs('#btnSelectHeader'),
	btnSelectTarget: qs('#btnSelectTarget'),
	btnSelectFixedHeader: qs('#btnSelectFixedHeader'),
	btnSelectHeaderRow: qs('#btnSelectHeaderRow'),
	positionSettingItem: qs('#positionSettingItem'),

	pdfCanvas: qs('#pdfCanvas'),
	lineCanvas: qs('#lineCanvas'),
	canvasContainer: qs('#canvasContainer'),
	selectionOverlay: qs('#selectionOverlay'),

	btnClearLines: qs('#btnClearLines'),
	btnClearHeader: qs('#btnClearHeader'),

	extractedList: qs('#extractedList'),
	extractCount: qs('#extractCount'),
	btnDownloadAll: qs('#btnDownloadAll'),
	btnPrevWork: qs('#btnPrevWork'),
	btnNextWork: qs('#btnNextWork'),
	btnClearImages: qs('#btnClearImages'),
	btnResetAlls: document.querySelectorAll('.btn-reset-all'),

	toast: qs('#toast'),
	toastMsg: qs('#toastMsg'),

	btnSettingsToggle: qs('#btnSettingsToggle'),
	settingsPopover: qs('#settingsPopover'),

	gridThreshold: qs('#gridThreshold'),
	thresholdValue: qs('#thresholdValue'),
	minLineLen: qs('#minLineLen'),
	minLineLenValue: qs('#minLineLenValue'),

	addBorderCheckbox: qs('#addBorderCheckbox'),

	btnToolSelect: qs('#btnToolSelect'),
	btnToolLine: qs('#btnToolLine'),
	btnToolRect: qs('#btnToolRect'),

	lineColor: qs('#lineColor'),
	lineWidth: qs('#lineWidth'),
	lineWidthValue: qs('#lineWidthValue')
};

// ===== Toast =====
export function showToast(msg, duration = 2500) {
	if (!dom.toast || !dom.toastMsg) return;
	dom.toastMsg.textContent = msg;
	dom.toast.classList.add('show');
	setTimeout(() => {
		dom.toast.classList.remove('show');
	}, duration);
}

// ===== Steps UI =====
export function showStep(n) {
	[dom.step1, dom.step2, dom.step3].forEach((s, i) => {
		if (!s) return;
		s.classList.toggle('hidden', i + 1 !== n);
		setTimeout(() => {
			s.style.opacity = (i + 1 === n) ? '1' : '0';
		}, 10);
	});
	[dom.st1, dom.st2, dom.st3].forEach((s, i) => {
		if (!s) return;
		s.classList.toggle('active', i + 1 === n);
		s.classList.toggle('completed', i + 1 < n);
	});
}

export function setupToggleGroup(containerId, stateKey, onChange) {
	const container = qs('#' + containerId);
	if (!container) return;
	const btns = container.querySelectorAll('button');

	btns.forEach((btn) => {
		btn.addEventListener('click', () => {
			btns.forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
			state[stateKey] = btn.dataset.value;
			if (onChange) onChange(state[stateKey]);
		});
	});
}

export function getCurrentListName() {
	if (state.selectedPages.length === 0) return '';
	const pageNum = state.selectedPages[state.currentWorkPage];
	for (let i = 0; i < state.pages.length; i++) {
		if (state.pages[i].pageNum === pageNum) {
			return state.pages[i].drawingName || 'unknown';
		}
	}
	return 'unknown';
}

export function getNextSeqNum(listName) {
	if (state.headerFileBaseName) return null;
	let count = 0;
	for (let i = 0; i < state.extractedImages.length; i++) {
		if (state.extractedImages[i].listName === listName) count++;
	}
	return count + 1;
}

export function renumberImages() {
	const counters = {};
	for (let i = 0; i < state.extractedImages.length; i++) {
		const img = state.extractedImages[i];
		if (img.customName) continue;
		if (img.fileBaseName) {
			img.name = img.fileBaseName;
			continue;
		}
		const ln = img.listName;
		counters[ln] = (counters[ln] || 0) + 1;
		img.name = ln + '_' + String(counters[ln]).padStart(3, '0');
	}
}

export function sanitizeFileBaseName(s) {
	if (!s) return '';
	let out = String(s)
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/[\s\u3000]+/g, ' ')
		.trim();

	out = out.replace(/[\\\/:\?"<>\|]/g, '');
	out = out.replace(/[\s.]+$/g, '').trim();
	if (out.length > 60) out = out.slice(0, 60).trim();
	return out;
}

export function resetPageSelection() {
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
	state.historyRegions = [];
	state.headerFileBaseName = '';

	if (dom.btnClearHeader) dom.btnClearHeader.disabled = true;
	if (dom.btnSelectTarget) dom.btnSelectTarget.disabled = true;
	if (dom.btnSelectHeaderRow) dom.btnSelectHeaderRow.disabled = true;

	state.mode =
		state.selectionMode === 'withHeader'
			? 'fixedHeader'
			: state.selectionMode === 'single'
				? 'single'
				: 'header';
}

export function resetWorkState() {
	state.extractedImages = [];
	state.scale = 2;
	if (dom.canvasContainer) {
		dom.canvasContainer.scrollLeft = 0;
		dom.canvasContainer.scrollTop = 0;
	}
	resetPageSelection();
}

export function clearAllOverlays() {
	if (!dom.selectionOverlay) return;
	dom.selectionOverlay
		.querySelectorAll('.selection-rect, .grid-cell-rect')
		.forEach((r) => r.remove());
}

export function toCanvasCoords(r) {
	const k = _renderScale / state.scale;
	return {
		x: r.x * k,
		y: r.y * k,
		w: r.w * k,
		h: r.h * k
	};
}

export function overlayToCanvasPoint(p) {
	const k = _renderScale / state.scale;
	return {
		x: p.x * k,
		y: p.y * k
	};
}

export function applyZoomTransform(drawUserLines, redrawState) {
	const r = state.scale / _renderScale;

	dom.pdfCanvas.style.transformOrigin = '0 0';
	dom.pdfCanvas.style.transform = r === 1 ? '' : `scale(${r})`;

	if (dom.lineCanvas) {
		dom.lineCanvas.style.transformOrigin = '0 0';
		dom.lineCanvas.style.transform = r === 1 ? '' : `scale(${r})`;
	}

	dom.selectionOverlay.style.width = (dom.pdfCanvas.width * r) + 'px';
	dom.selectionOverlay.style.height = (dom.pdfCanvas.height * r) + 'px';

	clearAllOverlays();
	if (redrawState) redrawState();
	if (drawUserLines) drawUserLines();
}