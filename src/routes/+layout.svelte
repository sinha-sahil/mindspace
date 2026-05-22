<script lang="ts">
	import '@fontsource-variable/geist/index.css';
	import '@fontsource-variable/geist-mono/index.css';
	import '@fontsource-variable/fraunces/wght.css';
	import '@fontsource-variable/fraunces/wght-italic.css';
	import '$lib/styles/theme.css';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { theme } from '$lib/client/modules/theme';
	import { Toaster } from '$lib/client/modules/toasts';
	import { analytics } from '$lib/client/modules/analytics';

	let { data, children } = $props();
	const { supabase, session, user, isAdmin } = $derived(data);

	onMount(() => {
		theme.set(theme.mode);
		analytics.init();
		if (user) {
			analytics.identify(user.id, { email: user.email ?? undefined, isAdmin });
		}
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, newSession) => {
			if (event === 'SIGNED_IN' && newSession?.user) {
				analytics.identify(newSession.user.id, {
					email: newSession.user.email ?? undefined,
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
