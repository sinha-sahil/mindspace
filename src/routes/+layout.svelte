<script lang="ts">
	import '@fontsource-variable/geist/index.css';
	import '@fontsource-variable/geist-mono/index.css';
	import '@fontsource-variable/fraunces/opsz.css';
	import '@fontsource-variable/fraunces/opsz-italic.css';
	import '$lib/styles/theme.css';
	import '$lib/styles/markdown.css';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { theme } from '$lib/client/modules/theme';
	import { Toaster } from '$lib/client/modules/toasts';
	import { analytics } from '$lib/client/modules/analytics';

	let { data, children } = $props();
	const { supabase, session, user, isAdmin } = $derived(data);

	onMount(() => {
		theme.set(theme.mode);
		theme.setAccent(theme.accent);
		analytics.init();
		if (user) {
			analytics.identify(user.id, { email: user.email, isAdmin });
		}
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, newSession) => {
			if (event === 'SIGNED_IN' && newSession?.user) {
				analytics.identify(newSession.user.id, {
					email: newSession.user.email,
					isAdmin
				});
				analytics.track('user_signed_in', { method: 'magic_link' });
			} else if (event === 'SIGNED_OUT') {
				analytics.track('user_signed_out');
				analytics.reset();
			}
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});
		return () => subscription.unsubscribe();
	});
</script>

<svelte:head>
	<title>mindspace</title>
	<link rel="icon" type="image/svg+xml" href="/logo.svg" />
</svelte:head>

{@render children()}

<Toaster />
