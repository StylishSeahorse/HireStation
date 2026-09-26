export function applyBranding(b: { primaryColour?: string | null; accentColour?: string | null; name?: string } | undefined) {
  const root = document.documentElement.style;
  if (b?.primaryColour) root.setProperty('--brand-primary', b.primaryColour); else root.removeProperty('--brand-primary');
  if (b?.accentColour) root.setProperty('--brand-accent', b.accentColour); else root.removeProperty('--brand-accent');
  if (b?.name) document.title = b.name;
}
