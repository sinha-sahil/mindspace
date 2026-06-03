<script lang="ts" module>
	import plus from '$lib/assets/icons/plus.svg?raw';
	import pencil from '$lib/assets/icons/pencil.svg?raw';
	import trash from '$lib/assets/icons/trash.svg?raw';
	import chevronLeft from '$lib/assets/icons/chevron-left.svg?raw';
	import chevronRight from '$lib/assets/icons/chevron-right.svg?raw';
	import chevronDown from '$lib/assets/icons/chevron-down.svg?raw';
	import check from '$lib/assets/icons/check.svg?raw';
	import copy from '$lib/assets/icons/copy.svg?raw';
	import lock from '$lib/assets/icons/lock.svg?raw';
	import link from '$lib/assets/icons/link.svg?raw';
	import logout from '$lib/assets/icons/logout.svg?raw';
	import shield from '$lib/assets/icons/shield.svg?raw';
	import key from '$lib/assets/icons/key.svg?raw';
	import sparkles from '$lib/assets/icons/sparkles.svg?raw';
	import sun from '$lib/assets/icons/sun.svg?raw';
	import moon from '$lib/assets/icons/moon.svg?raw';
	import monitor from '$lib/assets/icons/monitor.svg?raw';
	import sidebar from '$lib/assets/icons/sidebar.svg?raw';
	import arrowUpRight from '$lib/assets/icons/arrow-up-right.svg?raw';
	import circle from '$lib/assets/icons/circle.svg?raw';
	import circleDot from '$lib/assets/icons/circle-dot.svg?raw';
	import folder from '$lib/assets/icons/folder.svg?raw';
	import globe from '$lib/assets/icons/globe.svg?raw';
	import mail from '$lib/assets/icons/mail.svg?raw';
	import xIcon from '$lib/assets/icons/x.svg?raw';
	import search from '$lib/assets/icons/search.svg?raw';
	import fingerprint from '$lib/assets/icons/fingerprint.svg?raw';
	import command from '$lib/assets/icons/command.svg?raw';
	import settings from '$lib/assets/icons/settings.svg?raw';
	import grip from '$lib/assets/icons/grip.svg?raw';
	import pin from '$lib/assets/icons/pin.svg?raw';
	import undo from '$lib/assets/icons/undo.svg?raw';
	import refresh from '$lib/assets/icons/refresh.svg?raw';
	import alertCircle from '$lib/assets/icons/alert-circle.svg?raw';
	import infoCircle from '$lib/assets/icons/info-circle.svg?raw';
	import fileText from '$lib/assets/icons/file-text.svg?raw';
	import book from '$lib/assets/icons/book.svg?raw';
	import calendar from '$lib/assets/icons/calendar.svg?raw';
	import hash from '$lib/assets/icons/hash.svg?raw';
	import code from '$lib/assets/icons/code.svg?raw';
	import list from '$lib/assets/icons/list.svg?raw';
	import table from '$lib/assets/icons/table.svg?raw';
	import star from '$lib/assets/icons/star.svg?raw';
	import image from '$lib/assets/icons/image.svg?raw';
	import layout from '$lib/assets/icons/layout.svg?raw';

	export const ICONS = {
		plus: plus,
		pencil: pencil,
		trash: trash,
		'chevron-left': chevronLeft,
		'chevron-right': chevronRight,
		'chevron-down': chevronDown,
		check: check,
		copy: copy,
		lock: lock,
		link: link,
		logout: logout,
		shield: shield,
		key: key,
		sparkles: sparkles,
		sun: sun,
		moon: moon,
		monitor: monitor,
		sidebar: sidebar,
		'arrow-up-right': arrowUpRight,
		circle: circle,
		'circle-dot': circleDot,
		folder: folder,
		globe: globe,
		mail: mail,
		x: xIcon,
		search: search,
		fingerprint: fingerprint,
		command: command,
		settings: settings,
		grip: grip,
		pin: pin,
		undo: undo,
		refresh: refresh,
		'alert-circle': alertCircle,
		'info-circle': infoCircle,
		'file-text': fileText,
		book: book,
		calendar: calendar,
		hash: hash,
		code: code,
		list: list,
		table: table,
		star: star,
		image: image,
		layout: layout
	};

	export type IconName = keyof typeof ICONS;

	function strokeForSize(size: number): number {
		// Optical balance: smaller icons need thinner strokes to feel crisp.
		if (size <= 13) {
			return 1.5;
		}
		if (size <= 18) {
			return 1.75;
		}
		return 2;
	}
</script>

<script lang="ts">
	type Props = {
		name: IconName;
		size?: number;
		strokeWidth?: number;
		class?: string;
	};

	let { name, size = 16, strokeWidth, class: klass = '' }: Props = $props();
	const stroke = $derived(strokeWidth ?? strokeForSize(size));
</script>

<span
	class="icon {klass}"
	style="--icon-size: {size}px; --icon-stroke: {stroke};"
	aria-hidden="true"
>
	{@html ICONS[name]}
</span>

<style>
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--icon-size);
		height: var(--icon-size);
		flex-shrink: 0;
		line-height: 0;
		color: inherit;
	}
	.icon :global(svg) {
		width: 100%;
		height: 100%;
		stroke-width: var(--icon-stroke);
		display: block;
		shape-rendering: geometricPrecision;
	}
</style>
